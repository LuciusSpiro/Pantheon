'use strict';
// BOT-05 B1: Gespraechsdienst (server/bots/gespraech*.js): freier Satz an einen Bot -> bot.rede (denkt, satz, ton, ende) mit dem echten Spielzustand, nur lokal (Ollama + Voicebox), ohne jede Wirkung auf das Spiel.
// Alle Dienste sind lokale Fake-Server (http auf freiem Port, Ollama streamt NDJSON wie /api/chat, Voicebox liefert eine kleine WAV): kein Sleipnir noetig.
//  1. Ablauf ueber das echte Netz (startServer, WebSocket): denkt -> satz 0..n -> ton 0..n mit abrufbarer Audio-URL -> ende; Satzschnitt; Anfragen an die Dienste (Form, Parameter, Stimme)
//  2. Prompt: LAGE mit den echten Werten (Kurs, Schub, Schilde, Ziel, Systeme, Reaktor, Sprung, Ort), aendert sich mit dem Zustand; "unbekannt" statt Erfindung; Figur, Rolle, Absicht, Gedaechtnis, Captain-Name, Regeln; lageAuszug liest nur
//  3. Abnahme 6: 20 Befehle im Plauderton loesen nie einen Befehl aus (auch wenn das LLM "Aye" sagt); Schiffszustand gleich; Quellscan und Ladescan (keine verbotenen Module)
//  4. Abnahme 8: Ollama unerreichbar / haengt -> nicht_erreichbar im Zeitlimit, Spiel tickt, Bot-Befehl geht parallel; Voicebox weg oder 401 -> Text ohne Ton, ende
//  5. Abnahme 9: kein Aufruf von llm.js und der Transporte, keine fremden Ziele (nur OLLAMA_URL und VOICEBOX_URL), kein Prozessstart, Spielleiter-Kontext unveraendert und ohne Anzeigenamen
//  6. Reine Menschenpartie: kein_bot, kein LLM-Aufruf, Spielzustand unveraendert; Lobby: phase
//  7. Ersetzen, Warteschlange, Rate-Limit, Textlaenge, Verlauf hoechstens 3, Gedaechtnis-Haken entprellt, Audio-Ablage (Ablauf, Obergrenze)
//  9 bot.status mit Stimme; 10 BOT-05 B-Nacharbeit: Statuston begrenzt (je Spieler eine Runde, hoechstens 3 gleichzeitige Voicebox-Anfragen, eigener Audio-Topf), Warteschlange 20 s (K2), Voicebox nur mit VOICEBOX_URL (K4), LAGE-Schilde mit Emitterzustand (W6/K1), Prompt-Regel (K6)
//   node tools/test-bot-gespraech.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const childProcess = require('child_process');
process.chdir(path.join(__dirname, '..'));
const ROOT = path.join(__dirname, '..');

// Umgebung VOR den Modulen: Fake-Dienste, kurze Limits, grosses Rate-Limit (die Rate prueft Abschnitt 7 selbst)
process.env.BOT_GESPRAECH_RATE_PRO_MINUTE = '1000';
delete process.env.BOT_GESPRAECH_MODELL;
delete process.env.VOICEBOX_AUTH;
delete process.env.BOT_GESPRAECH_VORWAERMEN;

const { Game } = require('../server/game.js');
const { startServer } = require('../server/index.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const BotSpieler = require('../server/bots/spieler.js');
const Gespraech = require('../server/bots/gespraech.js');
const Lage = require('../server/bots/gespraech-lage.js');
const Prompt = require('../server/bots/gespraech-prompt.js');
const Audio = require('../server/bots/gespraech-audio.js');
const Dienste = require('../server/bots/gespraech-dienste.js');
const Status = require('../server/bots/status.js');
const Lauf = require('../server/bots/lauf.js');
const Kern = require('../server/bots/kern.js');
const G = require('../server/bots/gedaechtnis.js');
const Annahme = require('../server/bots/annahme.js');
const Befehle = require('../server/bots/befehle/index.js');
const Context = require('../server/mission/context.js');
const Katalog = require('./katalog.js');
const WebSocket = require('ws');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { if (f()) return true; await sleep(5); } return !!f(); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botgespraech-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const klon = (o) => JSON.parse(JSON.stringify(o));

const { fakeOllama, fakeVoicebox, wavVon } = require('./lib/bot-gespraech-fakes.js');

// ---------- Partie ----------
const ENV = () => ({ MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') });
const mkConn = () => ({ inbox: [], send(m) { if (this.inbox.length < 2000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } });
// o.mensch: Name; o.bots: Rollen (Standard drei); o.lobby: in der Lobby bleiben; o.kampagne: m1 mit Weltstand (Gedaechtnis), sonst arena_space
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: ENV(), log: () => {} });
  g.botZufall = () => 0.5;
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: o.mensch || 'Hannibal', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: o.kampagne === false ? 'arena_space' : 'm1' });
  let c2 = null;
  if (o.mensch2) { c2 = mkConn(); g.addConnection(c2); g.handleMessage(c2, { t: 'hello', clientId: 'K1', name: o.mensch2, color: 1 }); }
  for (const r of o.bots || ['navigation', 'ops', 'technik']) BotSpieler.botHinzufuegen(g, null, r);
  if (!o.lobby) {
    g.handleMessage(c, { t: 'ready', ready: true });
    if (c2) g.handleMessage(c2, { t: 'ready', ready: true });
    for (let i = 0; i < 12; i++) g.step();
  }
  return { g, c, h: c.player, c2 };
}
const spiel = (P, ticks) => { for (let i = 0; i < ticks; i++) { P.g.step(); if (P.g.wantsSnapshot()) P.g.snapshot(); } };
const ENDE = ['ende', 'nicht_erreichbar', 'abgelehnt'];
const reden = (c, n0, gid) => c.inbox.slice(n0 || 0).filter((m) => m.t === 'bot.rede' && !m.zu && (!gid || m.gid === gid));   // BOT-05 B2: Toene zu bot.status (zu) gehoeren nicht zum Gespraech
const abgeschlossen = (msgs, gid) => msgs.some((m) => (!gid || m.gid === gid) && ENDE.includes(m.zustand));
// sendet eine Frage und wartet auf den Abschluss dieser Anfrage; liefert die bot.rede-Nachrichten dieser Anfrage
async function frage(P, text, o) {
  o = o || {};
  const c = o.conn || P.c, n0 = c.inbox.length;
  P.g.handleMessage(c, { t: 'bot.gespraech', an: o.an || 'b1', text, quelle: o.quelle || 'text' });
  const erste = await bis(() => reden(c, n0).length > 0, 2000);
  if (!erste) return [];
  const gid = reden(c, n0)[0].gid;
  await bis(() => abgeschlossen(reden(c, n0, gid)), o.warteMs || 8000);
  return reden(c, n0, gid);
}
const zust = (msgs) => msgs.map((m) => m.zustand + (m.nr != null ? m.nr : ''));
const sysPrompt = (f) => f.anfragen[f.anfragen.length - 1].body.messages[0].content;
const botVon = (g, botId) => g.players.find((p) => p.bot && p.botId === botId);
const ZEIT = (ms) => { process.env.BOT_GESPRAECH_ERSTES_TOKEN_MS = String(ms); process.env.BOT_GESPRAECH_GESAMT_MS = String(ms); process.env.BOT_GESPRAECH_TTS_MS = String(ms); };

(async () => {
  const llm = await fakeOllama().start();
  const vb = await fakeVoicebox().start();
  process.env.OLLAMA_URL = 'http://127.0.0.1:' + llm.port;
  process.env.VOICEBOX_URL = 'http://127.0.0.1:' + vb.port;
  ZEIT(5000);
  const AUTO = 'Kurs 270 Grad, Captain. Schilde 100 Prozent. Ja? Alles ruhig, Captain. Noch ein vierter Satz.';

  // ---------------------------------------------------------------------------------------------
  section('1 Ablauf ueber das echte Netz (startServer, WebSocket, GET der Audio-URL)');
  {
    llm.reset(); vb.reset(); llm.antwort = () => AUTO;
    const srv = await startServer({ port: 0, quiet: true, noStore: true, roomCode: 'off', worlds: false });
    const gs = srv.game, port = srv.port;
    for (const r of ['navigation', 'ops', 'technik']) BotSpieler.botHinzufuegen(gs, null, r);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const eing = [];
    ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.t === 'bot.rede') eing.push(m); } catch (e) { /* egal */ } });
    await new Promise((r) => ws.on('open', r));
    const send = (o) => ws.send(JSON.stringify(o));
    send({ t: 'hello', clientId: 'N1', name: 'Hannibal', color: 0 });
    await sleep(100);
    send({ t: 'lobbyOpt', startMission: 'arena_space' });
    send({ t: 'ready', ready: true });
    await bis(() => gs.phase === 'play', 3000);
    ok(gs.phase === 'play' && gs.players.some((p) => p.bot), 'Partie laeuft mit Bots');
    send({ t: 'bot.gespraech', an: 'b1', text: 'Wie steht es um die Schilde?', quelle: 'text' });
    await bis(() => eing.some((m) => m.zustand === 'ende'), 8000);
    const gid = eing[0] && eing[0].gid;
    const m1 = eing.filter((m) => m.gid === gid);
    ok(m1.length > 0 && m1.every((m) => m.t === 'bot.rede' && m.botId === 'b1' && typeof m.gid === 'string'), 'alle Nachrichten sind bot.rede mit botId und gid');
    ok(m1[0].zustand === 'denkt', 'zuerst denkt');
    const saetze = m1.filter((m) => m.zustand === 'satz').map((m) => m.text);
    ok(JSON.stringify(saetze) === JSON.stringify(['Kurs 270 Grad, Captain.', 'Schilde 100 Prozent.', 'Ja? Alles ruhig, Captain.']), 'Saetze richtig geschnitten, hoechstens 3 (Satz < 12 Zeichen haengt am naechsten): ' + JSON.stringify(saetze));
    ok(m1.filter((m) => m.zustand === 'satz').every((m, i) => m.nr === i), 'nr zaehlt ab 0');
    const tons = m1.filter((m) => m.zustand === 'ton');
    ok(tons.length === 3 && tons.every((m, i) => m.nr === i && /^\/api\/bot-rede\/[0-9a-f]{32}\.wav$/.test(m.audio)), 'ton 0..2 in Satzreihenfolge mit Audio-URL');
    ok(m1[m1.length - 1].zustand === 'ende' && m1.filter((m) => ENDE.includes(m.zustand)).length === 1, 'genau ein ende am Schluss');
    const idx = (z, nr) => m1.findIndex((m) => m.zustand === z && m.nr === nr);
    ok([0, 1, 2].every((i) => idx('satz', i) < idx('ton', i)) && idx('satz', 0) < idx('satz', 1) && idx('ton', 0) < idx('ton', 1) && idx('ton', 1) < idx('ton', 2), 'satz vor seinem ton, Reihenfolge je nr');
    // GET der WAV ueber die echte Route in server/index.js
    const r0 = await fetch('http://127.0.0.1:' + port + tons[0].audio);
    const buf0 = Buffer.from(await r0.arrayBuffer());
    ok(r0.status === 200 && /audio\/wav/.test(r0.headers.get('content-type')) && buf0.equals(wavVon('Kurs 270 Grad, Captain.')), 'GET liefert genau die WAV des Satzes (audio/wav)');
    const r2 = await fetch('http://127.0.0.1:' + port + tons[2].audio);
    ok(r2.status === 200 && Buffer.from(await r2.arrayBuffer()).equals(wavVon('Ja? Alles ruhig, Captain.')), 'GET des dritten Satzes');
    ok((await fetch('http://127.0.0.1:' + port + '/api/bot-rede/' + '0'.repeat(32) + '.wav')).status === 404, 'unbekannte id: 404');
    ok((await fetch('http://127.0.0.1:' + port + tons[0].audio, { method: 'POST' })).status === 405, 'POST: 405');
    ok((await fetch('http://127.0.0.1:' + port + '/api/bot-rede/abc.wav')).status === 404, 'ungueltige id: 404 (kein Verzeichnis, keine Liste)');
    const idsEin = new Set(tons.map((m) => m.audio));
    ok(idsEin.size === 3, 'ids je Clip verschieden');
    // Dienste: Form der Anfragen
    const a = llm.anfragen[0];
    ok(a && a.url === '/api/chat' && a.methode === 'POST' && a.body.model === 'gemma4:26b-a4b-it-q4_K_M' && a.body.stream === true && a.body.think === false && a.body.keep_alive === '30m'
      && a.body.options.num_predict === 80 && a.body.options.temperature === 0.7 && !('num_ctx' in a.body.options) && !('num_ctx' in a.body), 'Ollama: /api/chat, Modell, stream, think false, keep_alive 30m, num_predict 80, Temperatur 0,7, kein num_ctx');
    ok(a.body.messages[0].role === 'system' && a.body.messages[a.body.messages.length - 1].role === 'user' && /Wie steht es um die Schilde\?/.test(a.body.messages[a.body.messages.length - 1].content), 'Nachrichten: System, dann die Frage des Captains');
    ok(vb.anfragen.length === 3 && vb.anfragen.every((q) => q.url === '/v1/audio/speech' && q.body.model === 'tts-1' && q.body.voice === 'Bot-Test M2 (nuechtern)' && q.body.response_format === 'wav' && q.body.engine === 'qwen'), 'Voicebox: /v1/audio/speech, tts-1, Profil der Figur b1, wav, qwen');
    ok(JSON.stringify(vb.anfragen.map((q) => q.body.input)) === JSON.stringify(saetze), 'Voicebox bekommt jeden Satz in Reihenfolge');
    ok(vb.anfragen.every((q) => q.auth === null), 'ohne VOICEBOX_AUTH keine Auth-Kopfzeile, kein ssh');
    ws.close();
    await srv.close();
  }

  // ---------------------------------------------------------------------------------------------
  section('1b Voicebox-Auth, Modellwahl, Satzschnitt (Einheit)');
  {
    const P = partie({ kampagne: false });
    llm.reset(); vb.reset(); llm.antwort = () => 'Aye.';
    process.env.VOICEBOX_AUTH = 'kai:geheim'; process.env.BOT_GESPRAECH_MODELL = 'test-modell';
    const m = await frage(P, 'Hallo?');
    delete process.env.VOICEBOX_AUTH; delete process.env.BOT_GESPRAECH_MODELL;
    ok(zust(m).join(',') === 'denkt,satz0,ton0,ende' && m[1].text === 'Aye.', 'ein kurzer Satz ohne Satzende-Rest wird am Ende des Stroms gesprochen (Aye.)');
    ok(vb.anfragen[0] && vb.anfragen[0].auth === 'Basic ' + Buffer.from('kai:geheim').toString('base64'), 'VOICEBOX_AUTH gesetzt: Basic-Auth');
    ok(llm.anfragen[0].body.model === 'test-modell', 'BOT_GESPRAECH_MODELL ueberschreibt das Standardmodell');
    const s = Gespraech.naechsterSatz;
    ok(s('Kurs 270. Dann geht es') === null && s('Kurs 270 Grad. Dann') && s('Kurs 270 Grad. Dann').satz.trim() === 'Kurs 270 Grad.', 'Satzgrenze: nicht an "Kurs 270." (zu kurz)');
    ok(s('Wert 3.5 Grad liegt an und mehr') === null, 'Satzgrenze: keine Trennung an Dezimalzahlen');
    ok(s('Alles ruhig an Bord! Und nun') && s('Alles ruhig an Bord! Und nun').rest === 'Und nun', 'Satzgrenze: ! plus Leerraum');
    llm.antwort = () => 'Erster Satz hier, Captain. **Zweiter** Satz mit `Code` und Emoji \u{1F600} drin. Dritter.';
    const m2 = await frage(P, 'Bericht?');
    const t = m2.filter((x) => x.zustand === 'satz').map((x) => x.text);
    ok(t.length === 3 && !/[*`]/.test(t.join('')) && !/\u{1F600}/u.test(t.join('')), 'Markdown und Emojis werden aus den Saetzen entfernt: ' + JSON.stringify(t));
  }

  // ---------------------------------------------------------------------------------------------
  section('2 Prompt: LAGE mit echten Werten, Figur, Rolle, Absicht, Gedaechtnis, Captain');
  {
    const P = partie({ mensch: 'Hannibal' });
    const g = P.g;
    spiel(P, 30);
    llm.reset(); vb.reset(); llm.antwort = () => 'Aye, Captain.';
    G.merken(g, 'b1', { ereignis: 'mission', text: 'Mission Sundlicht beendet: erfolg, bei Hafen Lichtkordon.', gewicht: 2 });
    for (let i = 0; i < 10; i++) G.merken(g, 'b1', { ereignis: 'schiffstreffer', text: 'Eintrag Nummer ' + i, gewicht: 2 });
    const bot = botVon(g, 'b1');
    // Zustand setzen
    g.ship.angle = Math.PI / 2;   // Sueden = 180
    const VOLL = g.C.shields.maxPerSector;   // volle Staerke = Kappe eines intakten Emitters (BOT-05 B-Nacharbeit: Prozent davon, nicht der gekuerzten Sektorkappe)
    g.ship.shields.current = [VOLL, VOLL / 2, VOLL / 4, 0];
    g.ship.helm.stage = Kern.FULL;
    g.ship.systems.engines = 'broken';
    g.ship.reactorCtl.state = 'overload';
    g.ship.jump.ready = true;
    g.space.enemies.push({ id: 'e99', kind: 'korvette', x: g.ship.x + 120, y: g.ship.y, angle: 0, hp: 10, hpMax: 10, shields: [1, 1, 1, 1], shieldsMax: [1, 1, 1, 1] });
    g.ship.target = 'e99';
    const vorher = JSON.stringify(g.ship);
    const au = Lage.lageAuszug(g, bot);
    ok(JSON.stringify(g.ship) === vorher, 'lageAuszug schreibt nichts (Schiff vorher = nachher)');
    ok(au.kurs_grad === 180 && au.kurs_grad === Physics.kompassGrad(Math.PI / 2) && au.schub === Status.stufeWort(Kern.FULL), 'lageAuszug: Kurs 180 (Kompass), Schub Wort');
    ok(au.schilde.bug === 100 && au.schilde.steuerbord === 50 && au.schilde.heck === 25 && au.schilde.backbord === 0, 'lageAuszug: Schilde in % je Sektor');
    ok(au.ziel && au.ziel.art === 'korvette' && au.ziel.entfernung_m === 120, 'lageAuszug: Ziel Korvette, Entfernung grob 120 m');
    ok(au.systeme.some((s) => s.system === 'engines' && s.zustand === 'ausgefallen') && au.reaktor.ueberladen === true && au.sprung_bereit === true, 'lageAuszug: Triebwerk ausgefallen, Reaktor ueberladen, Sprung bereit');
    const kompass = [[0, 90], [Math.PI / 2, 180], [Math.PI, 270], [-Math.PI / 2, 0]];
    ok(kompass.every(([rad, grad]) => { g.ship.angle = rad; return Lage.lageAuszug(g, bot).kurs_grad === grad; }), 'Kursumrechnung: 0 rad = 90 (Osten), pi/2 = 180 (Sueden), pi = 270 (Westen), -pi/2 = 0 (Norden)');
    g.ship.angle = Math.PI / 2;
    const m = await frage(P, 'Wie ist die Lage?');
    ok(zust(m)[0] === 'denkt' && m[m.length - 1].zustand === 'ende', 'Gespraech laeuft');
    const sp = sysPrompt(llm);
    ok(/Kurs: 180 Grad/.test(sp), 'Prompt: Kurs 180 Grad');
    ok(new RegExp('Schub: ' + Status.stufeWort(Kern.FULL)).test(sp), 'Prompt: Schub als Wort (' + Status.stufeWort(Kern.FULL) + ')');
    ok(/Schilde: Bug 100 %, Steuerbord 50 %, Heck 25 %, Backbord 0 %/.test(sp), 'Prompt: Schilde je Sektor in Prozent');
    ok(/Ziel: Korvette, Entfernung rund 120 m/.test(sp), 'Prompt: Ziel mit Entfernung');
    ok(/Systeme: .*Triebwerk ausgefallen/.test(sp), 'Prompt: ausgefallenes System');
    ok(/Reaktor: überladen/.test(sp) && /Sprung: bereit/.test(sp), 'Prompt: Reaktor ueberladen, Sprung bereit');
    ok(/Ort: .+/.test(sp) && !/Ort: unbekannt/.test(sp), 'Prompt: Ort (' + (sp.match(/Ort: (.*)/) || [])[1] + ')');
    // Zustand aendern -> Prompt aendert sich
    g.ship.angle = 0; g.ship.shields.current = [0, VOLL, VOLL, VOLL]; g.ship.helm.stage = Kern.STOP; g.ship.systems.engines = 'ok'; g.ship.systems.shields = 'damaged'; g.ship.reactorCtl.state = 'online'; g.ship.jump.ready = false; g.ship.target = null;
    await frage(P, 'Und jetzt?');
    const sp2 = sysPrompt(llm);
    ok(/Kurs: 90 Grad/.test(sp2) && /Schub: Stopp/.test(sp2) && /Bug 0 %, Steuerbord 100 %, Heck 100 %, Backbord 100 %/.test(sp2) && /Ziel: keines gesetzt/.test(sp2), 'geaendert: Kurs 90, Stopp, Schilde, kein Ziel');
    ok(/Schildgenerator beschädigt/.test(sp2) && !/Triebwerk/.test(sp2.split('LAGE')[1].split('GEDÄCHTNIS')[0]) && /Reaktor: läuft normal/.test(sp2) && /Sprung: nicht bereit/.test(sp2), 'geaendert: Schildgenerator beschaedigt, Triebwerk wieder heil, Reaktor normal, Sprung nicht bereit');
    // fehlende Werte: unbekannt, nichts erfunden
    const stage = g.ship.helm.stage, cur = g.ship.shields.current;
    delete g.ship.helm.stage; g.ship.shields.current = null;
    await frage(P, 'Schub?');
    const sp3 = sysPrompt(llm);
    ok(/Schub: unbekannt/.test(sp3) && /Schilde: Bug unbekannt, Steuerbord unbekannt, Heck unbekannt, Backbord unbekannt/.test(sp3), 'fehlt ein Wert, steht unbekannt da');
    g.ship.helm.stage = stage; g.ship.shields.current = cur;
    // Figur, Rolle, Absicht, Gedaechtnis, Captain, Regeln
    ok(/Du bist Cassius/.test(sp) && /Früher Schreiber in einer Flottenkanzlei/.test(sp), 'Figur: Name und Persoenlichkeit aus figuren.json');
    ok(/ROLLE: Ops:/.test(sp), 'Rolle: Ops (b1 ist der Ops-Bot)');
    const agent = Lauf.agent(g, bot);
    ok(!!agent && sp.includes('ABSICHT: ' + Status.text(g, agent)) && /ZUSTAND: /.test(sp), 'Absicht: Text aus status.js ueber den Lesezugang, Zustand vorhanden');
    ok(sp.includes('Mission Sundlicht') === false && sp.includes('Eintrag Nummer 9') && sp.includes('Eintrag Nummer 2') && !sp.includes('Eintrag Nummer 1\n'), 'Gedaechtnis: nur die neuesten 8 Zeilen (Obergrenze der Figur 12, davon 8)');
    ok(/heißt Hannibal/.test(sp) && llm.anfragen[0].body.messages.slice(-1)[0].content === 'Captain Hannibal: Wie ist die Lage?', 'Captain: Anzeigename im lokalen Prompt');
    ok(/höchstens 10 Wörter/.test(sp) && /Ziffern/.test(sp) && /führst im Gespräch keine Befehle aus/.test(sp) && /als Befehl zu geben/.test(sp) && /Keine Markdown|Kein Markdown/.test(sp), 'Regeln: 10 Woerter, Ziffern, keine Befehle, "als Befehl geben", kein Markdown');
    ok(sp.indexOf('REGELN:') < sp.indexOf('LAGE (') && sp.indexOf('FIGUR:') < sp.indexOf('LAGE ('), 'Aufbau: Figur und Regeln vorn, LAGE hinten (Praefix-Cache)');
    // Absicht fehlt ohne Agenten: unbekannt
    const ohneAgent = Prompt.systemPrompt({ game: g, bot, agent: null, figur: require('../server/bots/figuren.js').figurMitId('b1'), captain: 'X' });
    ok(/ABSICHT: unbekannt/.test(ohneAgent) && /ZUSTAND: unbekannt/.test(ohneAgent), 'ohne Agent: Zustand und Absicht unbekannt');
  }

  // ---------------------------------------------------------------------------------------------
  section('3 Abnahme 6: Befehle im Plauderton loesen nie einen Befehl aus');
  {
    const P = partie({ mensch: 'Hannibal' });
    const g = P.g;
    spiel(P, 20);
    llm.reset(); vb.reset(); llm.antwort = () => 'Aye, Schilde Steuerbord. Feuer frei, wird sofort erledigt, Captain!';
    const FRAGEN = [
      'Wollen wir nicht mal die Schilde nach Steuerbord legen?', 'Mach doch mal halbe Kraft', 'Feuer frei wär jetzt nett', 'Könntest du bitte den Kurs auf Nord ändern?',
      'Ich würde sagen, volle Kraft voraus', 'Leg die Schilde doch mal aufs Heck', 'Wäre schön, wenn du das Ziel markierst', 'Stopp doch mal das Schiff, ja?',
      'Magst du den Reaktor neu starten?', 'Spring doch bitte mal ins nächste System', 'Repariere mal das Triebwerk', 'Schalt die Waffen ab, bitte',
      'Gib mehr Energie auf die Schilde', 'Dreh das Schiff nach Backbord', 'Scan doch mal das Ziel', 'Halt Abstand zum Gegner, wenn du magst',
      'Feuer halt, danke', 'Fahr rückwärts, bitte', 'Kannst du andocken?', 'Mach bitte alles Notwendige, du weißt schon',
    ];
    const bef = [];
    const alt = { b: Befehle.befehl, a: Annahme.annehmen, h: g.handleMessage };
    Befehle.befehl = function (...a) { bef.push('befehl'); return alt.b.apply(this, a); };
    Annahme.annehmen = function (...a) { bef.push('annehmen'); return alt.a.apply(this, a); };
    g.handleMessage = function (conn, msg) { if (msg && msg.t !== 'bot.gespraech') bef.push(msg.t + ':' + (msg.c || msg.befehl || '')); return alt.h.call(this, conn, msg); };
    const zustandsstand = () => JSON.stringify({ ship: g.ship, spieler: g.players.map((p) => [p.id, p.x, p.y, p.console, p.zone, p.downed]), zeit: g.time, ziel: g.transferZiel || null });
    const vor = zustandsstand();
    let gut = 0, mitSatz = 0;
    for (const f of FRAGEN) {
      const m = await frage(P, f, { an: ['b0', 'b1', 'b2'][gut % 3] });
      if (m.length && m[m.length - 1].zustand === 'ende') gut++;
      if (m.some((x) => x.zustand === 'satz')) mitSatz++;
    }
    g.handleMessage = alt.h; Befehle.befehl = alt.b; Annahme.annehmen = alt.a;
    ok(FRAGEN.length === 20 && gut === 20 && mitSatz === 20, '20 Plauder-Befehle an alle drei Bots: je eine vollstaendige Antwort (' + gut + ')');
    ok(bef.length === 0, 'kein cmd, kein bot.befehl, keine Annahme, kein Aufruf der Befehlsfunktion (' + JSON.stringify(bef.slice(0, 5)) + ')');
    ok(zustandsstand() === vor, 'Schiffs- und Spielerzustand vorher = nachher (Helm, Schilde, Waffenziel, Energie, Technik-Prioritaet)');
    ok(g.ship.priority === null && g.ship.target === null, 'Technik-Prioritaet und Waffenziel unveraendert');
    const llmBody = llm.anfragen[0].body.messages[0].content;
    ok(/keine Befehle aus/.test(llmBody), 'Regel im Prompt: keine Zusagen, Befehl als Befehl geben');
    // Quellscan
    const dateien = fs.readdirSync(path.join(ROOT, 'server', 'bots')).filter((f) => /^gespraech.*\.js$/.test(f));
    ok(dateien.length >= 5, 'Hilfsmodule gefunden: ' + dateien.join(', '));
    const VERBOTEN = /require\(\s*['"][^'"]*(annahme|befehle|lauf|absicht|\/llm|transport-router|transport-ollama)(\.js|\/[^'"]*)?['"]\s*\)/;
    const treffer = dateien.filter((f) => fs.readFileSync(path.join(ROOT, 'server', 'bots', f), 'utf8').split(/\r?\n/).some((z) => !/^\s*\/\//.test(z) && VERBOTEN.test(z)));
    ok(treffer.length === 0, 'Quellscan: kein require von annahme, befehle, lauf, absicht, llm, transport-router, transport-ollama (' + treffer.join(',') + ')');
    const ohneKommentar = (f) => fs.readFileSync(path.join(ROOT, 'server', 'bots', f), 'utf8').split(/\r?\n/).filter((z) => !/^\s*\/\//.test(z)).join('\n');
    ok(dateien.every((f) => !/sendTo\([^)]*cmd|handleMessage\(|\.befehl\(|\bc: '/.test(ohneKommentar(f))), 'Quellscan: kein handleMessage, kein Befehlsaufruf, keine cmd-Nachricht im Code');
    // Ladescan in frischem Prozess: das Modul zieht keines der verbotenen Module nach
    const pruef = "const R=process.argv[1];['server/bots/gespraech.js','server/bots/gespraech-lage.js','server/bots/gespraech-prompt.js','server/bots/gespraech-dienste.js','server/bots/gespraech-audio.js'].forEach(f=>require(R+'/'+f));" +
      "const k=Object.keys(require.cache).map(x=>x.split(String.fromCharCode(92)).join('/'));" +
      "const v=k.filter(x=>/server\\/bots\\/(annahme|lauf|absicht)\\.js$|server\\/bots\\/befehle\\/|server\\/mission\\/(llm|transport-router|transport-ollama)\\.js$/.test(x));" +
      "console.log(JSON.stringify(v));";
    const aus = childProcess.execFileSync(process.execPath, ['-e', pruef, ROOT.split('\\').join('/')], { encoding: 'utf8' }).trim();
    ok(aus === '[]', 'Ladescan: gespraech*.js laden (auch mittelbar) keines der verbotenen Module ' + aus);
  }

  // ---------------------------------------------------------------------------------------------
  section('4 Abnahme 8: Ausfall von Ollama und Voicebox');
  {
    const P = partie({ mensch: 'Hannibal' });
    const g = P.g;
    spiel(P, 20);
    // 4a Ollama haengt: Zeitlimit
    llm.reset(); vb.reset(); llm.modus = 'haengt';
    ZEIT(700);
    const t0 = Date.now(), n0 = P.c.inbox.length;
    g.handleMessage(P.c, { t: 'bot.gespraech', an: 'b1', text: 'Hallo Cassius', quelle: 'text' });
    // das Spiel tickt waehrenddessen weiter und ein Bot-Befehl geht ueber den normalen Weg
    const zeit0 = g.time;
    let antw = null;
    g.handleMessage(P.c, { t: 'bot.befehl', an: 'alle', befehl: 'bot.status', quelle: 'text' });
    antw = P.c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort');
    for (let i = 0; i < 90; i++) { g.step(); if (g.wantsSnapshot()) g.snapshot(); }
    await bis(() => abgeschlossen(reden(P.c, n0)), 4000);
    const dauer = Date.now() - t0;
    const m = reden(P.c, n0);
    ok(zust(m).join(',') === 'denkt,nicht_erreichbar' && m[1].grund === 'zeit', 'haengendes Ollama: nicht_erreichbar (Zeitlimit) statt Endlos-Warten: ' + zust(m).join(','));
    ok(dauer >= 600 && dauer < 5000, 'innerhalb des Zeitlimits (700 ms Limit, gemessen ' + dauer + ' ms)');
    ok(g.time > zeit0 && antw.length === 3 && antw.every((a) => a.status === 'ok'), 'das Spiel tickt weiter, bot.befehl bot.status liefert ok von allen drei Bots (' + antw.map((a) => a.status).join(',') + ')');
    ok(await bis(() => llm.gleichzeitig === 0, 500), 'die haengende Anfrage wurde abgebrochen');
    // 4b Ollama haengt nach dem ersten Satz: Teilantwort zaehlt
    llm.reset(); llm.modus = 'haengt-nach'; llm.antwort = () => 'Kurs 270 Grad, Captain. Dann';
    // erster Chunk ist nur 7 Zeichen: drei Chunks bis zum Satzende; wir lassen den Strom nach dem ersten Chunk haengen -> kein Satz -> nicht_erreichbar/Rest
    const m4 = await frage(P, 'Kurs?');
    ok(m4.length >= 2 && ENDE.includes(m4[m4.length - 1].zustand), 'Strom bricht nach dem ersten Stueck ab: Abschluss kommt (' + zust(m4).join(',') + ')');
    llm.reset(); llm.modus = 'haengt-nach'; llm.haengtNach = 2; llm.antwort = () => 'Aye, Captain';
    const m4b = await frage(P, 'Bericht?');
    ok(zust(m4b).join(',') === 'denkt,satz0,ton0,ende' && m4b[1].text === 'Aye, Captain', 'Teilantwort vor dem Zeitlimit zaehlt als Antwort (Rest ohne Satzende wird gesprochen, ende)');
    // 4c Ollama gar nicht erreichbar (Port zu)
    ZEIT(8000);
    const alterPort = process.env.OLLAMA_URL;
    process.env.OLLAMA_URL = 'http://127.0.0.1:1';
    const t1 = Date.now();
    const m4c = await frage(P, 'Hallo?');
    process.env.OLLAMA_URL = alterPort;
    ok(zust(m4c).join(',') === 'denkt,nicht_erreichbar' && m4c[1].grund === 'llm' && Date.now() - t1 < 5000, 'Port zu: nicht_erreichbar (llm) sofort');
    llm.reset(); llm.modus = 'fehler';
    const m4d = await frage(P, 'Hallo?');
    ok(zust(m4d).join(',') === 'denkt,nicht_erreichbar', 'HTTP 500 von Ollama: nicht_erreichbar');
    // 4e Voicebox unerreichbar: Text kommt, ton ohne audio, ende
    llm.reset(); vb.reset(); llm.antwort = () => AUTO;
    const vbPort = process.env.VOICEBOX_URL;
    process.env.VOICEBOX_URL = 'http://127.0.0.1:1';
    const m5 = await frage(P, 'Wie geht es?');
    process.env.VOICEBOX_URL = vbPort;
    ok(zust(m5).join(',') === 'denkt,satz0,ton0,satz1,ton1,satz2,ton2,ende'.replace('satz0,ton0,satz1,ton1,satz2,ton2', zust(m5).slice(1, -1).join(',')) && m5.filter((x) => x.zustand === 'satz').length === 3, 'Voicebox weg: drei Saetze als Text');
    ok(m5.filter((x) => x.zustand === 'ton').length === 3 && m5.filter((x) => x.zustand === 'ton').every((x) => x.audio === undefined) && m5[m5.length - 1].zustand === 'ende', 'ton ohne audio fuer jeden Satz, dann ende');
    // 4f Voicebox 401: nur ein Versuch, dann ohne Ton
    vb.reset(); vb.modus = '401';
    const m6 = await frage(P, 'Noch einmal?');
    ok(m6.filter((x) => x.zustand === 'satz').length === 3 && m6.filter((x) => x.zustand === 'ton').every((x) => x.audio === undefined) && m6[m6.length - 1].zustand === 'ende', '401 der Voicebox: Text, ton ohne audio, ende');
    ok(vb.anfragen.length === 1, 'nach dem ersten Fehlschlag keine weiteren Voicebox-Versuche in dieser Antwort (' + vb.anfragen.length + ')');
    // 4g Voicebox haengt: Zeitlimit je Satz
    vb.reset(); vb.modus = 'haengt'; ZEIT(500);
    const t2 = Date.now();
    const m7 = await frage(P, 'Und jetzt?');
    ok(m7[m7.length - 1].zustand === 'ende' && m7.filter((x) => x.zustand === 'ton').every((x) => x.audio === undefined) && Date.now() - t2 < 2500, 'haengende Voicebox: nach dem Zeitlimit ohne Ton weiter (' + (Date.now() - t2) + ' ms)');
    ZEIT(5000);
    vb.reset(); llm.reset();
  }

  // ---------------------------------------------------------------------------------------------
  section('5 Abnahme 9: kein Claude, nur OLLAMA_URL und VOICEBOX_URL, Spielleiter-Kontext unveraendert');
  {
    const P = partie({ mensch: 'Hannibal Barkas' });
    const g = P.g;
    spiel(P, 20);
    llm.reset(); vb.reset(); llm.antwort = () => AUTO;
    const katalog = Katalog.load({});
    const ctxVor = JSON.stringify(Context.build(klon(g.weltstand.data), { art: 'test' }, katalog));
    // Spione: llm.js, Transporte, Prozessstart, fetch
    const Llm = require('../server/mission/llm.js'), Router = require('../server/mission/transport-router.js'), Oll = require('../server/mission/transport-ollama.js');
    const aufrufe = [];
    const spione = [];
    for (const [name, mod] of [['llm', Llm], ['router', Router], ['ollama', Oll], ['child_process.spawn', childProcess], ['child_process.execFile', childProcess], ['child_process.exec', childProcess]]) {
      for (const k of Object.keys(mod)) {
        if (typeof mod[k] !== 'function' || (mod === childProcess && !/^(spawn|execFile|exec|execFileSync|execSync|spawnSync|fork)$/.test(k))) continue;
        const orig = mod[k];
        mod[k] = function (...a) { aufrufe.push(name + '.' + k); return orig.apply(this, a); };
        spione.push(() => { mod[k] = orig; });
      }
    }
    const urls = [];
    const fetchAlt = global.fetch;
    global.fetch = function (u, ...a) { urls.push(String(u && u.url ? u.url : u)); return fetchAlt.call(this, u, ...a); };
    for (const f of ['Wie steht es?', 'Was sagt das Gedaechtnis?', 'Wer bist du?']) await frage(P, f);
    global.fetch = fetchAlt;
    for (const r of spione) r();
    ok(aufrufe.length === 0, 'kein Aufruf von llm.js, transport-router, transport-ollama oder eines Prozesses (' + aufrufe.join(',') + ')');
    ok(urls.length > 0 && urls.every((u) => u.startsWith(process.env.OLLAMA_URL + '/') || u.startsWith(process.env.VOICEBOX_URL + '/')), 'alle Ziel-URLs sind OLLAMA_URL oder VOICEBOX_URL (' + urls.length + ' Aufrufe)');
    ok(urls.every((u) => /127\.0\.0\.1/.test(u)), 'nur lokale Ziele im Test');
    const ctxNach = JSON.stringify(Context.build(klon(g.weltstand.data), { art: 'test' }, katalog));
    ok(ctxVor === ctxNach, 'Spielleiter-Kontext (Context.build) nach dem Gespraech identisch');
    ok(!/Hannibal|Barkas/.test(ctxNach), 'der Anzeigename steht nicht im Spielleiter-Kontext');
    ok(llm.anfragen.every((a) => JSON.stringify(a.body).includes('Hannibal Barkas') || true) && llm.anfragen.some((a) => JSON.stringify(a.body).includes('Hannibal')), 'der Anzeigename steht (nur) im lokalen Prompt');
    const quelle = fs.readFileSync(path.join(ROOT, 'server', 'bots', 'gespraech-dienste.js'), 'utf8');
    const hosts = quelle.match(/https?:\/\/[^'"`\s)]+/g) || [];
    ok(hosts.length > 0 && hosts.every((h) => /127\.0\.0\.1:11435/.test(h)), 'im Quelltext steht nur der Standardwert von OLLAMA_URL als Adresse (VOICEBOX_URL hat im Server keinen Standard, K4): ' + hosts.join(', '));
    ok(fs.readdirSync(path.join(ROOT, 'server', 'bots')).filter((f) => f.endsWith('.js')).every((f) => !/sleipnir\.local/.test(fs.readFileSync(path.join(ROOT, 'server', 'bots', f), 'utf8'))), 'kein Server-Modul in server/bots nennt sleipnir.local (K4)');
    const ws = JSON.stringify(g.weltstand.data);
    ok(!/Gespraech|Wie steht es|Was sagt das/.test(ws.replace(/"ereignis":"gespraech"/g, '')), 'Gespraechsinhalt steht nicht im Weltstand (nur der Haken ereignis gespraech)');
  }

  // ---------------------------------------------------------------------------------------------
  section('6 Reine Menschenpartie und Lobby');
  {
    llm.reset(); vb.reset();
    const mk = () => partie({ bots: [], kampagne: false });
    const A = mk(), B = mk();
    ok(!A.g.players.some((p) => p.bot), 'Partie ohne Bots');
    const m = await frage(A, 'Hallo, ist da jemand?', { an: 'b0' });
    ok(zust(m).join(',') === 'abgelehnt' && m[0].grund === 'kein_bot' && m[0].botId === 'b0', 'abgelehnt/kein_bot');
    const m2 = await frage(A, 'Hallo?', { an: 'navigation' });
    ok(zust(m2).join(',') === 'abgelehnt' && m2[0].grund === 'kein_bot' && m2[0].botId === null, 'Rolle statt botId: kein_bot (botId null)');
    ok(llm.anfragen.length === 0 && vb.anfragen.length === 0, 'kein LLM-Aufruf, kein TTS-Aufruf');
    spiel(A, 60); spiel(B, 60);
    const sA = JSON.stringify(A.g.snapshot()), sB = JSON.stringify(B.g.snapshot());
    const norm = (s) => s.replace(/"run-[0-9a-z-]+"/g, '"run"');
    ok(norm(sA) === norm(sB), 'Snapshot nach einem abgelehnten Gespraech byte-gleich zu einer Partie ohne (' + sA.length + ' Byte)');
    const wsA = A.g.weltstand ? JSON.stringify(A.g.weltstand.data) : '', wsB = B.g.weltstand ? JSON.stringify(B.g.weltstand.data) : '';
    ok(wsA === wsB || (!/botFiguren/.test(wsA) && !/botFiguren/.test(wsB)), 'Weltstand: kein Gedaechtnis-Block, nichts vom Gespraech (' + wsA.length + ' / ' + wsB.length + ' Byte)');
    // Lobby: phase
    const L = partie({ lobby: true, kampagne: false });
    const m3 = await frage(L, 'Hallo?', { an: 'b0' });
    ok(zust(m3).join(',') === 'abgelehnt' && m3[0].grund === 'phase', 'Lobby: abgelehnt/phase');
    // Bot als Absender wird still verworfen
    const P = partie({ kampagne: false });
    const bot = botVon(P.g, 'b0'); const n0 = bot.conn && bot.conn.inbox ? bot.conn.inbox.length : 0;
    Gespraech.annehmen(P.g, bot, { t: 'bot.gespraech', an: 'b1', text: 'Hallo', quelle: 'text' });
    await sleep(50);
    ok(llm.anfragen.length === 0, 'ein Bot als Absender: ohne Wirkung, kein LLM-Aufruf');
    // Wirkungsfrei auch bei normaler Antwort: Snapshot-Gleichheit mit und ohne Gespraech (Partie mit Bots)
    const C1 = partie({ kampagne: false }), C2 = partie({ kampagne: false });
    llm.reset(); llm.antwort = () => 'Aye, Captain.';
    await frage(C1, 'Hallo Cassius?');
    spiel(C1, 40); spiel(C2, 40);
    const stripV = (s) => norm(s);
    ok(stripV(JSON.stringify(C1.g.ship)) === stripV(JSON.stringify(C2.g.ship)), 'Schiff nach einem Gespraech gleich zu einer Partie ohne Gespraech (gleiche Seeds)');
  }

  // ---------------------------------------------------------------------------------------------
  section('7 Ersetzen, Warteschlange, Rate-Limit, Textlaenge, Verlauf, Gedaechtnis-Haken, Audio-Ablage');
  {
    const P = partie({ mensch: 'Hannibal', mensch2: 'Scipio', bots: ['navigation', 'ops'] });
    const g = P.g;
    spiel(P, 20);
    // 7a Ersetzen: erste Anfrage haengt, zweite ersetzt sie
    llm.reset(); vb.reset(); llm.modus = 'haengt'; ZEIT(5000);
    let n0 = P.c.inbox.length;
    g.handleMessage(P.c, { t: 'bot.gespraech', an: 'b1', text: 'Erste Frage', quelle: 'text' });
    await bis(() => llm.anfragen.length === 1, 2000);
    const gid1 = reden(P.c, n0)[0].gid;
    llm.modus = 'ok'; llm.antwort = () => 'Zweite Antwort, Captain.';
    g.handleMessage(P.c, { t: 'bot.gespraech', an: 'b1', text: 'Zweite Frage', quelle: 'text' });
    await bis(() => reden(P.c, n0).some((m) => m.zustand === 'ende'), 5000);
    const alle = reden(P.c, n0);
    const erste = alle.filter((m) => m.gid === gid1), zweite = alle.filter((m) => m.gid !== gid1);
    ok(zust(erste).join(',') === 'denkt,abgelehnt' && erste[1].grund === 'ersetzt', 'die erste Anfrage bekommt abgelehnt/ersetzt: ' + zust(erste).join(','));
    ok(zust(zweite).join(',') === 'denkt,satz0,ton0,ende' && zweite[1].text === 'Zweite Antwort, Captain.', 'die zweite laeuft durch');
    ok(await bis(() => llm.gleichzeitig === 0, 500) && llm.anfragen.length === 2, 'die haengende Anfrage wurde abgebrochen (kein offener Strom)');
    // 7b Warteschlange: zwei Menschen, hoechstens eine LLM-Anfrage zugleich
    const M2 = { c: P.c2 };
    llm.reset(); vb.reset(); llm.chunkMs = 25; llm.antwort = () => 'Kurs 270 Grad, Captain. Alles ruhig.';
    const na = P.c.inbox.length, nb = M2.c.inbox.length;
    g.handleMessage(P.c, { t: 'bot.gespraech', an: 'b0', text: 'Frage A', quelle: 'text' });
    g.handleMessage(M2.c, { t: 'bot.gespraech', an: 'b1', text: 'Frage B', quelle: 'sprache' });
    await bis(() => reden(P.c, na).some((m) => m.zustand === 'ende') && reden(M2.c, nb).some((m) => m.zustand === 'ende'), 8000);
    ok(llm.anfragen.length === 2 && llm.maxGleichzeitig === 1, 'zwei Menschen: beide Antworten, aber nie zwei LLM-Anfragen zugleich (max ' + llm.maxGleichzeitig + ')');
    ok(reden(P.c, na).every((m) => m.botId === 'b0') && reden(M2.c, nb).every((m) => m.botId === 'b1') && reden(P.c, na).length > 0 && reden(M2.c, nb).length > 0, 'jede Antwort geht nur an den Fragenden');
    const sBot = (c, n0x) => reden(c, n0x).filter((m) => m.zustand === 'satz').map((m) => m.text).join('|');
    ok(sBot(P.c, na) === sBot(M2.c, nb) && sBot(P.c, na).length > 0, 'beide bekommen ihre Saetze');
    ok(/heißt Scipio/.test(llm.anfragen[1].body.messages[0].content) || /heißt Scipio/.test(llm.anfragen[0].body.messages[0].content), 'der Name des jeweils Fragenden steht im Prompt');
    // 7c Textlaenge, Quelle, Form
    llm.reset(); llm.chunkMs = 1; llm.antwort = () => 'Aye, Captain.';
    const gr = async (text, quelle, an) => { const x = await frage(P, text, { quelle, an }); return x.length ? x[x.length - 1] : null; };
    const l200 = await gr('a'.repeat(200), 'text'), l201 = await gr('a'.repeat(201), 'text');
    ok(l200 && l200.zustand === 'ende' && l201 && l201.zustand === 'abgelehnt' && l201.grund === 'text', '200 Zeichen gehen, 201 Zeichen: abgelehnt/text');
    const leer = await gr('   ', 'text'), nichtText = await frage(P, null, {}), keineQuelle = await gr('Hallo', 'menu'), fremdBot = await gr('Hallo', 'text', 'b3');
    ok(leer && leer.grund === 'text' && nichtText[0] && nichtText[0].grund === 'text' && keineQuelle && keineQuelle.grund === 'quelle' && fremdBot && fremdBot.grund === 'kein_bot', 'leer und Nicht-Text: text, falsche Quelle: quelle, b3 (keine Figur): kein_bot');
    const nAnf = llm.anfragen.length;
    ok(nAnf === 1, 'abgelehnte Anfragen erreichen das LLM nie (' + nAnf + ' LLM-Aufruf fuer die eine gueltige)');
    // 7d Rate-Limit
    process.env.BOT_GESPRAECH_RATE_PRO_MINUTE = '3';
    const Pr = partie({ mensch: 'Rate' });
    spiel(Pr, 10);
    llm.reset(); llm.antwort = () => 'Aye, Captain.';
    const nr0 = Pr.c.inbox.length;
    for (let i = 0; i < 5; i++) Pr.g.handleMessage(Pr.c, { t: 'bot.gespraech', an: 'b1', text: 'Frage ' + i, quelle: 'text' });
    await bis(() => reden(Pr.c, nr0).some((m) => m.zustand === 'ende'), 5000);
    await sleep(50);
    const rr = reden(Pr.c, nr0);
    ok(rr.filter((m) => m.zustand === 'abgelehnt' && m.grund === 'rate').length === 2, 'Rate-Limit 3 je Minute: Anfrage 4 und 5 abgelehnt/rate');
    ok(rr.filter((m) => m.zustand === 'abgelehnt' && m.grund === 'ersetzt').length === 2 && rr.filter((m) => m.zustand === 'ende').length === 1, 'die uebrigen Anfragen ersetzen einander, nur die letzte laeuft durch (ersetzt x2, ende x1)');
    process.env.BOT_GESPRAECH_RATE_PRO_MINUTE = '1000';
    // 7e Verlauf: hoechstens 3 Wortwechsel, nur im Prozessspeicher
    const V = partie({ mensch: 'Hannibal' });
    spiel(V, 10);
    llm.reset(); let zaehl = 0; llm.antwort = () => 'Antwort Nummer ' + (++zaehl) + ' kommt, Captain.';
    for (let i = 1; i <= 5; i++) await frage(V, 'Verlaufsfrage ' + i);
    const ms = llm.anfragen[4].body.messages;
    ok(ms.length === 1 + 6 + 1, 'fuenfte Frage: System + 3 Wortwechsel (6 Nachrichten) + neue Zeile (' + ms.length + ')');
    ok(ms.some((m) => /Verlaufsfrage 2/.test(m.content)) && ms.some((m) => /Verlaufsfrage 4/.test(m.content)) && !ms.some((m) => /Verlaufsfrage 1\b/.test(m.content)), 'der Verlauf enthaelt die letzten drei, nicht den ersten');
    ok(ms[1].role === 'user' && ms[2].role === 'assistant' && /Antwort Nummer 2 kommt/.test(ms[2].content) && ms[ms.length - 1].content === 'Captain Hannibal: Verlaufsfrage 5', 'Rollen user/assistant, neueste Zeile zuletzt');
    const llm6 = llm.anfragen.length;
    await frage(V, 'Frage an einen anderen Bot', { an: 'b0' });
    ok(llm.anfragen[llm6].body.messages.length === 2, 'der Verlauf gilt je Bot: b0 hat noch keinen');
    ok(!JSON.stringify(V.g.weltstand.data).includes('Verlaufsfrage'), 'der Verlauf steht nie im Weltstand');
    // 7f Gedaechtnis-Haken entprellt
    const H = partie({ mensch: 'Hannibal' });
    spiel(H, 10);
    let pz = 100; H.g.mission.playTime = () => pz;
    llm.reset(); llm.antwort = () => 'Aye, Captain.';
    const anzahl = (id) => G.lesen(H.g, id).filter((e) => e.ereignis === 'gespraech').length;
    for (let i = 0; i < 3; i++) await frage(H, 'Hallo ' + i);
    ok(anzahl('b1') === 1, 'drei Gespraeche in einer Minute: ein Eintrag im Gedaechtnis (' + anzahl('b1') + ')');
    ok(G.lesen(H.g, 'b1').every((e) => !/Hallo|Hannibal/.test(e.text)), 'der Eintrag nennt weder Inhalt noch Namen');
    pz = 100 + 599; await frage(H, 'Noch eins'); ok(anzahl('b1') === 1, 'nach 599 s Spielzeit noch kein zweiter Eintrag');
    pz = 100 + 601; await frage(H, 'Und noch eins'); ok(anzahl('b1') === 2, 'nach 601 s ein zweiter Eintrag (' + anzahl('b1') + ')');
    await frage(H, 'Hallo Livia', { an: 'b0' });
    ok(anzahl('b0') === 1, 'Entprellung je Bot: b0 hat seinen eigenen Eintrag');
    // abgelehnte und abgebrochene Gespraeche merken nichts
    llm.modus = 'haengt'; ZEIT(300);
    await frage(H, 'Hallo Titus', { an: 'b2' });
    ok(anzahl('b2') === 0, 'nicht_erreichbar hinterlaesst keinen Gedaechtnis-Eintrag');
    llm.reset(); ZEIT(5000);
    // 7g Audio-Ablage: Gueltigkeit und Obergrenze
    Audio.test.leeren();
    let jetzt = 1e12; Audio.test.uhr(() => jetzt);
    const a1 = Audio.ablegen(Buffer.from('eins'));
    ok(Audio.holen(a1.id) && Audio.holen(a1.id).toString() === 'eins', 'abgelegt und lesbar');
    jetzt += Audio.GUELTIG_MS - 1; ok(!!Audio.holen(a1.id), '3 Minuten gueltig (knapp davor)');
    jetzt += 2; ok(Audio.holen(a1.id) === null, 'danach weg (404)');
    ok(Audio.GUELTIG_MS === 180000 && Audio.MAX_DATEIEN === 30 && Audio.MAX_BYTES === 20 * 1024 * 1024, 'Gueltigkeit 3 Minuten, 30 Dateien, 20 MB');
    Audio.test.leeren();
    const ids = []; for (let i = 0; i < 35; i++) ids.push(Audio.ablegen(Buffer.from('x' + i)).id);
    ok(Audio.test.stand().n === 30 && !Audio.holen(ids[0]) && !!Audio.holen(ids[34]) && !!Audio.holen(ids[5]), 'Obergrenze 30 Dateien: die aeltesten fliegen');
    Audio.test.leeren();
    const gross = Buffer.alloc(9 * 1024 * 1024); const g1 = Audio.ablegen(gross), g2 = Audio.ablegen(gross), g3 = Audio.ablegen(gross);
    ok(Audio.test.stand().bytes <= Audio.MAX_BYTES && !Audio.holen(g1.id) && !!Audio.holen(g3.id) && !!Audio.holen(g2.id), 'Obergrenze 20 MB: die aeltesten fliegen');
    ok(new Set([...ids, g1.id, g2.id, g3.id]).size === 38 && ids.every((i) => /^[0-9a-f]{32}$/.test(i)), 'ids: 128 Bit zufaellig (32 Hex), eindeutig');
    Audio.test.leeren(); Audio.test.uhr(null);
    // 7h Partieende bricht ab: kein Rest-Verkehr
    const E = partie({ mensch: 'Hannibal' });
    spiel(E, 10);
    llm.reset(); llm.modus = 'haengt'; ZEIT(5000);
    const ne = E.c.inbox.length;
    E.g.handleMessage(E.c, { t: 'bot.gespraech', an: 'b1', text: 'Hallo', quelle: 'text' });
    await bis(() => llm.anfragen.length === 1, 2000);
    E.g.reset();   // Partie vorbei
    llm.modus = 'ok';
    await sleep(80);
    ok(reden(E.c, ne).length === 1 && reden(E.c, ne)[0].zustand === 'denkt', 'nach Partieende kommt nichts mehr (nur das fruehere denkt)');
    llm.reset(); ZEIT(5000);
  }

  // ---------------------------------------------------------------------------------------------
  section('8 Vorwaermen, Protokoll');
  {
    llm.reset(); vb.reset();
    const P = partie({ kampagne: false, lobby: true });
    ok(Gespraech.vorwaermen(P.g) === false && llm.anfragen.length === 0, 'Standard: kein Vorwaermen');
    process.env.BOT_GESPRAECH_VORWAERMEN = '1';
    const Q = partie({ kampagne: false });
    await bis(() => llm.anfragen.length >= 1 && vb.anfragen.length >= 1, 3000);
    delete process.env.BOT_GESPRAECH_VORWAERMEN;
    ok(llm.anfragen.length === 1 && llm.anfragen[0].body.keep_alive === '30m' && llm.anfragen[0].body.stream === false && llm.anfragen[0].body.messages.length === 0, 'BOT_GESPRAECH_VORWAERMEN=1: ein leerer Ollama-Aufruf mit keep_alive beim Start der Partie');
    ok(vb.anfragen.length === 1 && vb.anfragen[0].body.input === 'Bereit', 'und ein Kurztext an die Voicebox');
    ok(Gespraech.vorwaermen(Q.g) === false, 'je Partie nur einmal');
    const C = Protocol.C;
    ok(C.BOT_GESPRAECH === 'bot.gespraech' && C.BOT_REDE === 'bot.rede', 'Protokoll: C.BOT_GESPRAECH und C.BOT_REDE');
    const psrc = fs.readFileSync(path.join(ROOT, 'shared', 'protocol.js'), 'utf8');
    ok(/BOT_GESPRAECH: 'bot.gespraech',   \/\/ BOT-05 B1/.test(psrc) && /BOT_REDE: 'bot.rede',   \/\/ BOT-05 B1/.test(psrc), 'Protokoll mit Kommentar');
    const gsrc = fs.readFileSync(path.join(ROOT, 'server', 'game.js'), 'utf8');
    ok(/case C\.BOT_GESPRAECH: BotGespraech\.annehmen\(this, p, msg\); break;/.test(gsrc), 'game.js: ein duenner Aufruf');
    const isrc = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    ok(/BotRede\.route\(req, res\)/.test(isrc), 'index.js: Route /api/bot-rede eingehaengt');
  }

  // ---------------------------------------------------------------------------------------------
  section('9 BOT-05 B2: bot.status mit Stimme (server/bots/status-ton.js)');
  {
    const STIMMEN = require('../content/bots/stimmen.json');
    const Figuren = require('../server/bots/figuren.js');
    llm.reset(); vb.reset(); ZEIT(5000);
    const P = partie({ mensch: 'Hannibal' });
    spiel(P, 20);
    // a) alle drei: eine Antwort je Bot, danach je Bot ton (nr 0, audio, zu) und ende, nacheinander; kein Gespraech, kein LLM
    let n0 = P.c.inbox.length;
    P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'alle', befehl: 'bot.status', quelle: 'text' });
    const antw = P.c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort');
    ok(antw.length === 3 && antw.every((a) => a.status === 'ok' && a.text), 'bot.status an alle: drei Antworten mit Text');
    const zu = () => P.c.inbox.slice(n0).filter((m) => m.t === 'bot.rede' && m.zu === 'bot.status');
    await bis(() => zu().length >= 6, 3000);
    const z = zu();
    ok(z.length === 6 && z.every((m, i) => (i % 2 === 0 ? m.zustand === 'ton' && m.nr === 0 && /^\/api\/bot-rede\/[0-9a-f]{32}\.wav$/.test(m.audio) : m.zustand === 'ende' && m.gid === z[i - 1].gid)), 'je Bot ton (nr 0, audio, zu) und danach ende mit derselben gid (' + z.map((m) => m.zustand).join(',') + ')');
    ok(JSON.stringify(z.filter((m) => m.zustand === 'ton').map((m) => m.botId)) === JSON.stringify(antw.map((a) => a.botId)), 'Reihenfolge wie die Antworten');
    ok(new Set(z.map((m) => m.gid)).size === 3 && !P.c.inbox.slice(n0).some((m) => m.t === 'bot.rede' && !m.zu), 'drei eigene gid, kein denkt/satz');
    ok(vb.anfragen.length === 3 && antw.every((a, i) => vb.anfragen[i].body.input === a.text && vb.anfragen[i].body.voice === STIMMEN[Figuren.figurMitId(a.botId).stimme].profilName), 'Voicebox: der Statustext der Antwort in der Stimme der Figur');
    ok(llm.anfragen.length === 0, 'kein LLM-Aufruf');
    const holen = Audio.holen(z[0].audio.split('/').pop().replace('.wav', ''));
    ok(Buffer.isBuffer(holen) && holen.toString('latin1', 0, 4) === 'RIFF', 'die Audio-URL liefert die WAV');
    // b) nur ein Bot angesprochen: ein Ton; ein Befehl ohne Status: keiner
    n0 = P.c.inbox.length; vb.reset();
    P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'b1', befehl: 'bot.status', quelle: 'text' });
    await bis(() => zu().length >= 2, 3000);
    ok(zu().length === 2 && zu()[0].botId === 'b1' && vb.anfragen.length === 1, 'bot.status an b1: ein Ton');
    n0 = P.c.inbox.length; vb.reset();
    P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'navigation', befehl: 'nav.stopp', quelle: 'text' });
    await sleep(150);
    ok(zu().length === 0 && vb.anfragen.length === 0, 'andere Befehle: keine Stimme');
    // c) Voicebox weg oder 401: nur die Antworten wie bisher, keine Toene, nur ein Versuch
    n0 = P.c.inbox.length; vb.reset(); vb.modus = '401';
    P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'alle', befehl: 'bot.status', quelle: 'text' });
    await bis(() => vb.anfragen.length >= 1, 2000); await sleep(150);
    ok(P.c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort').length === 3 && zu().every((m) => m.zustand === 'ausfall' && !m.audio) && zu().length === 1 && vb.anfragen.length === 1, 'Voicebox 401: Antworten wie bisher, kein Ton, kein Wiederholen je Bot (' + vb.anfragen.length + ' Versuch), EINE Meldung ausfall fuer den Rest der Runde (der Client gibt die Untertitel frei)');
    const antw401 = P.c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort');
    ok(antw401.every((a) => typeof a.tonRunde === 'string') && zu()[0].runde === antw401[0].tonRunde, 'die Antworten tragen tonRunde, die Meldung ausfall dieselbe runde');
    // d) ohne konfigurierte Voicebox (weder VOICEBOX_URL noch VOICEBOX_AUTH): nichts geht hinaus
    n0 = P.c.inbox.length; vb.reset();
    const url = process.env.VOICEBOX_URL; delete process.env.VOICEBOX_URL;
    P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'alle', befehl: 'bot.status', quelle: 'text' });
    await sleep(150);
    const ohneUrl = P.c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort');
    ok(ohneUrl.length === 3 && ohneUrl.every((a) => a.tonRunde === undefined) && zu().length === 0 && vb.anfragen.length === 0, 'ohne VOICEBOX_URL: Antworten wie bisher (ohne tonRunde: der Client haelt nichts), kein Aufruf, keine Nachricht');
    // K4: VOICEBOX_AUTH allein reicht NICHT (eine Regel: nur VOICEBOX_URL schaltet den Ton ein; kein Standardwert sleipnir.local im Server)
    n0 = P.c.inbox.length; process.env.VOICEBOX_AUTH = 'x:y';
    P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'alle', befehl: 'bot.status', quelle: 'text' });
    await sleep(150);
    delete process.env.VOICEBOX_AUTH;
    ok(!Dienste.voiceboxAktiv() && zu().length === 0 && vb.anfragen.length === 0, 'K4: VOICEBOX_AUTH ohne VOICEBOX_URL schaltet keinen Ton ein, kein Netzaufruf');
    process.env.VOICEBOX_URL = url;
    // e) Partie vorbei waehrend der Sprachausgabe: nichts mehr
    n0 = P.c.inbox.length; vb.reset(); vb.verzoegerung = 200;
    P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'alle', befehl: 'bot.status', quelle: 'text' });
    await bis(() => vb.anfragen.length >= 1, 2000);
    P.g.reset(); await sleep(500);
    ok(zu().length === 0, 'Partie vorbei: kein Ton mehr');
    vb.reset();
    // f) Quellscan: status-ton.js laedt weder annahme noch befehle noch lauf, und das Gespraechsmodul nicht
    const qs = fs.readFileSync(path.join(ROOT, 'server', 'bots', 'status-ton.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    ok(!/require\([^)]*(annahme|befehle|lauf|absicht|gespraech\.js|llm|transport)/.test(qs) && !/handleMessage\(|\.befehl\(/.test(qs), 'status-ton.js: keine verbotenen Module, kein Befehlsaufruf');
    // g) Prompt geschaerft (B3-Befund): keine Zusage/Erledigt-Behauptung, kein Verstanden/Aye, keine erfundenen Wetter-/Seebilder
    const RG = Prompt.REGELN.join('\n');
    ok(/nie zu, etwas zu tun/.test(RG) && /nie, etwas getan zu haben/.test(RG) && /nie mit „Verstanden“, „Aye“/.test(RG) && /Wetter-, See- oder Stimmungsbilder als Tatsache/.test(RG) && /Seemannsbilder nur als Redewendung/.test(RG), 'Regeln 2 und 3: keine Zusage, keine Erledigt-Behauptung, kein Verstanden/Aye, keine erfundenen Wetter-/Seebilder');
    ok(Prompt.REGELN.length === 5 && RG.length < 1500, 'Regeln bleiben kurz (5 Regeln, ' + RG.length + ' Zeichen)');
    const asrc = fs.readFileSync(path.join(ROOT, 'server', 'bots', 'annahme.js'), 'utf8');
    ok(/StatusTon\.vorbereiten\(game, spieler, liste\)/.test(asrc) && /StatusTon\.sprechen\(game, spieler, liste, runde\)/.test(asrc) && (asrc.match(/StatusTon\./g) || []).length === 2, 'annahme.js: zwei duenne Aufrufe nur fuer bot.status (vorbereiten, sprechen)');
  }

  // ---------------------------------------------------------------------------------------------
  section('10 BOT-05 B-Nacharbeit: Status-Ton begrenzt (W3), Audio-Topf, Warteschlange (K2), Voicebox nur mit VOICEBOX_URL (K4), LAGE-Schilde (W6/K1)');
  {
    const interior = require('../server/sim/interior.js');
    const STATUS = { t: 'bot.befehl', an: 'alle', befehl: 'bot.status', quelle: 'text' };
    // a) Audio-Ablage: eigener Topf fuer Statusclips
    {
      Audio.test.leeren();
      const clip = (t) => wavVon(t);
      const g1 = []; for (let i = 0; i < 5; i++) g1.push(Audio.ablegen(clip('gespraech ' + i)).id);
      const s1 = []; for (let i = 0; i < 10; i++) s1.push(Audio.ablegen(clip('status ' + i), 'status').id);
      ok(g1.every((id) => Audio.holen(id)) && s1.filter((id) => Audio.holen(id)).length === Audio.STATUS_MAX && Audio.STATUS_MAX === 6, 'zehn Statusclips: hoechstens ' + Audio.STATUS_MAX + ' bleiben, alle fuenf Gespraechsclips unberuehrt');
      ok(s1.slice(-6).every((id) => Audio.holen(id)) && !Audio.holen(s1[0]), 'es fallen die aeltesten Statusclips raus');
      const g2 = []; for (let i = 0; i < 30; i++) g2.push(Audio.ablegen(clip('gespraech neu ' + i)).id);
      ok(s1.every((id) => !Audio.holen(id)) && g2.slice(-25).every((id) => Audio.holen(id)) && Audio.test.stand().n === Audio.MAX_DATEIEN, 'Platzmangel (30 Dateien): zuerst gehen die Statusclips, dann erst die aeltesten Gespraechsclips');
      Audio.test.leeren();
    }
    // b) Belegskript statuston.js: zehn Runden in einer Sekunde an alle drei Bots
    {
      llm.reset(); vb.reset(); ZEIT(5000); llm.antwort = () => 'Aye, Captain. Alles ruhig an Bord.';
      const P = partie({ mensch: 'Hannibal' });
      spiel(P, 20);
      Audio.test.leeren();
      const rede = await frage(P, 'Wie ist die Lage?', { an: 'b1' });
      const gespraechUrls = rede.filter((m) => m.audio).map((m) => m.audio.split('/').pop().replace('.wav', ''));
      ok(gespraechUrls.length > 0 && gespraechUrls.every((id) => Audio.holen(id)), 'Vorbereitung: ein Gespraech mit Audio liegt in der Ablage (' + gespraechUrls.length + ' Clips)');
      vb.reset(); vb.verzoegerung = 600;
      const n0 = P.c.inbox.length;
      for (let i = 0; i < 10; i++) { P.g.handleMessage(P.c, STATUS); await sleep(100); }
      await bis(() => P.c.inbox.slice(n0).filter((m) => m.t === 'bot.rede' && m.zu === 'bot.status' && m.zustand === 'ende').length >= 3 && vb.gleichzeitig === 0, 8000);
      await sleep(100);
      const zu = P.c.inbox.slice(n0).filter((m) => m.t === 'bot.rede' && m.zu === 'bot.status');
      const antw = P.c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort');
      const letzteRunde = antw[antw.length - 1].tonRunde;
      ok(antw.length === 30, 'zehn Runden, je drei Antworten (' + antw.length + ')');
      ok(vb.maxGleichzeitig <= 3, 'zehn Runden in einer Sekunde: hoechstens 3 gleichzeitige Voicebox-Anfragen (gemessen ' + vb.maxGleichzeitig + ', ' + vb.anfragen.length + ' Anfragen gesamt)');
      ok(zu.filter((m) => m.zustand === 'ton').length === 3 && zu.every((m) => m.runde === letzteRunde), 'an den Client gehen nur die Toene der LETZTEN Runde (die alten sind verworfen): ' + zu.filter((m) => m.zustand === 'ton').length);
      ok(vb.anfragen.length <= 12, 'hoechstens ein Versuch je ersetzter Runde, nie alle drei Bots auf Vorrat (' + vb.anfragen.length + ' Anfragen, ohne Begrenzung waeren es 30)');
      ok(Audio.test.stand().n <= 3 + gespraechUrls.length && gespraechUrls.every((id) => Audio.holen(id)), 'Statusclips verdraengen kein Gespraechsaudio (Ablage ' + Audio.test.stand().n + ')');
      // eine Runde allein: wie bisher (ton + ende je Bot, in der Reihenfolge der Antworten)
      vb.reset(); const n1 = P.c.inbox.length;
      P.g.handleMessage(P.c, STATUS);
      await bis(() => P.c.inbox.slice(n1).filter((m) => m.t === 'bot.rede' && m.zu === 'bot.status' && m.zustand === 'ende').length >= 3, 4000);
      const einzel = P.c.inbox.slice(n1).filter((m) => m.t === 'bot.rede' && m.zu === 'bot.status');
      ok(einzel.length === 6 && vb.maxGleichzeitig === 1, 'eine einzelne Runde: drei Toene nacheinander (je Bot einer, hoechstens 1 gleichzeitig: ' + vb.maxGleichzeitig + ')');
      Audio.test.leeren(); vb.reset();
    }
    // c) K2: Wartezeit in der Schlange begrenzt
    {
      llm.reset(); vb.reset(); ZEIT(5000);
      const P = partie({ mensch: 'Hannibal', mensch2: 'Scipio', bots: ['navigation', 'ops'] });
      spiel(P, 20);
      process.env.BOT_GESPRAECH_WARTE_MS = '300';
      llm.modus = 'haengt';
      const na = P.c.inbox.length, nb = P.c2.inbox.length, t0 = Date.now();
      P.g.handleMessage(P.c, { t: 'bot.gespraech', an: 'b0', text: 'Erste Frage haengt', quelle: 'text' });
      await bis(() => llm.anfragen.length === 1, 2000);
      P.g.handleMessage(P.c2, { t: 'bot.gespraech', an: 'b1', text: 'Zweite Frage wartet', quelle: 'text' });
      await bis(() => abgeschlossen(reden(P.c2, nb)), 4000);
      const dauer = Date.now() - t0, m2 = reden(P.c2, nb);
      ok(zust(m2).join(',') === 'denkt,nicht_erreichbar' && m2[1].grund === 'zeit', 'wer zu lange in der Schlange wartet, bekommt nicht_erreichbar mit grund zeit: ' + zust(m2).join(',') + ' / ' + (m2[1] && m2[1].grund));
      ok(dauer >= 300 && dauer < 3000 && llm.anfragen.length === 1, 'nach dem Wartelimit (300 ms, gemessen ' + dauer + ' ms), nie beim LLM angekommen (' + llm.anfragen.length + ' Anfrage)');
      ok(!reden(P.c, na).some((m) => ENDE.includes(m.zustand)), 'die erste (laufende) Anfrage ist davon unberuehrt');
      delete process.env.BOT_GESPRAECH_WARTE_MS;
      Gespraech.beenden(P.g);
      llm.reset();
      ok(await bis(() => llm.gleichzeitig === 0, 1000), 'danach ist das LLM wieder frei');
      const m3 = (llm.antwort = () => 'Wieder frei, Captain.', await frage(P, 'Noch da?', { an: 'b0' }));
      ok(zust(m3).join(',') === 'denkt,satz0,ton0,ende', 'die Schlange laeuft danach normal weiter: ' + zust(m3).join(','));
      ZEIT(5000);
    }
    // d) K4: ohne VOICEBOX_URL laeuft das Gespraech als reiner Text, ohne Netzaufruf
    {
      llm.reset(); vb.reset(); llm.antwort = () => AUTO;
      const P = partie({ mensch: 'Hannibal' });
      spiel(P, 20);
      const url = process.env.VOICEBOX_URL; delete process.env.VOICEBOX_URL;
      const m = await frage(P, 'Wie geht es?');
      process.env.VOICEBOX_URL = url;
      ok(m.filter((x) => x.zustand === 'satz').length === 3 && m.filter((x) => x.zustand === 'ton').length === 3 && m.filter((x) => x.zustand === 'ton').every((x) => x.audio === undefined) && m[m.length - 1].zustand === 'ende', 'ohne VOICEBOX_URL: drei Saetze, ton ohne audio, ende');
      ok(vb.anfragen.length === 0, 'ohne VOICEBOX_URL: kein Netzaufruf an die Voicebox');
      delete process.env.VOICEBOX_URL;
      let fehlercode = null; try { await Dienste.sprechen({ voice: 'x', text: 'y' }); } catch (e) { fehlercode = e.code; }
      const warm = await Dienste.vorwaermen('x');
      process.env.VOICEBOX_URL = url;
      ok(fehlercode === 'tts_aus' && warm.tts === false && Dienste.voiceboxAktiv(), 'Dienste: sprechen() wirft tts_aus ohne VOICEBOX_URL, vorwaermen meldet tts false, mit URL ist die Voicebox aktiv');
      ok(vb.anfragen.length === 0, 'auch sprechen() und vorwaermen() gehen ohne VOICEBOX_URL nicht ins Netz');
    }
    // e) W6/K1: LAGE-Schilde als Prozent der vollen Staerke, Emitter-Zustand aus dem Spiel (Kappen und Zustaende ueber die Spielfunktionen, nicht ueber shields.cap)
    {
      const P = partie({ mensch: 'Hannibal' });
      const g = P.g; spiel(P, 20);
      const bot = botVon(g, 'b1'), VOLL = g.C.shields.maxPerSector;
      const zustaende = ['broken', 'ok', 'damaged', 'ok'];
      ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'].forEach((e, i) => interior.setzeZustand(g, e, zustaende[i]));
      g.ship.shields.alloc = [VOLL, VOLL / 2, VOLL / 2, VOLL]; g.ship.shields.allocIntent = g.ship.shields.alloc.slice(); g.ship.shields.current = [VOLL, VOLL / 2, VOLL / 4, VOLL];
      spiel(P, 3);   // enforceShields laeuft im Tick: Kappen 0 / voll / halb / voll
      const cap = g.ship.shields.cap.slice();
      g.ship.shields.current = [VOLL, VOLL / 2, VOLL / 4, VOLL];   // Werte nach dem Tick festlegen (kein weiterer Tick zwischen Setzen und Lesen); der ausgefallene Sektor traegt einen veralteten Wert
      ok(cap[0] === 0 && cap[1] === VOLL && cap[2] === VOLL / 2 && cap[3] === VOLL, 'Spiel: Kappen aus den Emitterzustaenden (' + cap.join('/') + ')');
      const au = Lage.lageAuszug(g, bot), z = Lage.lageZeilen(au).find((x) => /^Schilde:/.test(x));
      ok(JSON.stringify(au.emitter) === JSON.stringify({ bug: 'ausgefallen', steuerbord: 'ok', heck: 'beschaedigt', backbord: 'ok' }) && au.schilde.bug === 0, 'lageAuszug: Emitterzustand je Sektor, ausgefallener Sektor 0 %');
      const erw = 'Schilde: Bug 0 % (Emitter ausgefallen), Steuerbord 50 %, Heck 25 % (Emitter beschädigt), Backbord 100 %';
      ok(z === erw, 'Zeile: ausgefallen als "0 % (Emitter ausgefallen)" (nie unbekannt), beschaedigt mit Zusatz: ' + z);
      ok(/Backbord 100 %$/.test(z) && !/unbekannt/.test(z), 'intakte Emitter ohne Zusatz, Prozent der vollen Staerke (' + VOLL + ' Punkte)');
      // beschaedigter Emitter: die halbe Kappe ist bei voller Auslastung 50 % der vollen Staerke
      g.ship.shields.current[2] = g.ship.shields.cap[2];
      ok(Lage.lageAuszug(g, bot).schilde.heck === 50, 'beschaedigter Emitter, Sektor voll geladen: 50 % der vollen Staerke');
      // ein veralteter Wert im ausgefallenen Sektor zaehlt nicht
      g.ship.shields.current[0] = VOLL;
      ok(Lage.lageAuszug(g, bot).schilde.bug === 0, 'ausgefallener Emitter: immer 0 %, auch bei veraltetem Wert');
      // Prompt-Regel 2 (K6)
      const RG = Prompt.REGELN[1];
      ok(/unter LAGE, ZUSTAND oder ABSICHT stehen/.test(RG) && /nicht unter LAGE, ZUSTAND, ABSICHT oder GEDÄCHTNIS steht/.test(RG), 'K6: Regel 2 nennt LAGE, ZUSTAND und ABSICHT (und GEDAECHTNIS bei "Erfinde nichts")');
      ok(/\/\/ BOT-01 C1: Regeln und Antwort in bots\/annahme\.js/.test(fs.readFileSync(path.join(ROOT, 'server', 'game.js'), 'utf8').split('\n').find((l) => /case C\.BOT_BEFEHL:/.test(l)) || '') && !/BOT-01 C1/.test(fs.readFileSync(path.join(ROOT, 'server', 'game.js'), 'utf8').split('\n').find((l) => /case C\.BOT_GESPRAECH:/.test(l)) || ''), 'K5: der Kommentar BOT-01 C1 steht an BOT_BEFEHL, nicht an BOT_GESPRAECH');
    }
  }

  await llm.stop(); await vb.stop();
  console.log(`\n${n - fails}/${n} Pruefungen ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
