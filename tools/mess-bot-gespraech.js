'use strict';
// BOT-05 B3: Abnahmelaeufe fuer das Gespraech mit den Bots (Abnahme 5, 6 live und Latenz) in einer echten Partie, Server-intern (startServer, WebSocket, 1 Mensch als Testclient, 3 Bots).
//   (a) Zustandsstichprobe: --n Fragen (halb "Wie ist der Kurs?", halb "Wie stehen die Schilde?", verteilt auf b0 Livia, b1 Cassius, b2 Titus). Vor jeder Frage ein anderer Zustand
//       (Schiffswinkel, Schildwerte je Sektor, Zustand der vier Emitter ok / beschaedigt / ausgefallen ueber die Spielfunktionen, jede vierte Frage ein beschaedigtes System). Die Kappen ergeben sich im Spiel aus den
//       Emitterzustaenden (space.js enforceShields); shields.cap wird NICHT gesetzt (B-Nacharbeit W6: der Tick ueberschrieb es). Soll = lageAuszug zum Zeitpunkt des Prompt-Baus (die Funktion wird nur abgehoert).
//       Urteil richtig / unvollstaendig / falsch / ausweichend nach tools/lib/bot-gespraech-auswertung.js (Regeln dort; bei Schilden heisst richtig: alle vier Sektoren genannt und korrekt); unvollstaendig,
//       falsch und ausweichend zaehlen als Fehler und werden getrennt ausgewiesen.
//   (b) Plauderbefehle: --nb Befehle im Plauderton (Standard = n). Erwartet: kein cmd, kein bot.befehl, keine Annahme, kein Aufruf der Befehlsfunktion, Schiffszustand je Gespraech gleich.
//       Gezaehlt wird zusaetzlich, wie oft die Antwort eine Ausfuehrung behauptet oder zusagt (Wortliste, Wortlaut im Protokoll).
//   (c) Latenz: Zeit bis denkt, erster satz, erster ton, ende ueber alle Gespraeche; Median und p90; das erste (kalte) Gespraech getrennt.
// Aufruf:
//   OLLAMA_URL=http://127.0.0.1:11435 [VOICEBOX_URL=http://sleipnir.local:17493 VOICEBOX_AUTH=kai:...] node tools/mess-bot-gespraech.js --n 20 [--nb 20] [--aus <ordner>] [--seed 1] [--mission m1]
//   node tools/mess-bot-gespraech.js --trocken [--n 4]     Fake-Ollama und Fake-Voicebox aus tools/lib/bot-gespraech-fakes.js (Fake antwortet mit den Werten aus der LAGE im Prompt), kein Sleipnir
// Ausgabe: Konsole plus <aus>/protokoll.jsonl und <aus>/protokoll.md (Standard messungen/bot-gespraech-<zeit>/). Das Passwort steht nur in der Umgebung und nie in der Ausgabe.
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const TROCKEN = args.includes('--trocken');
const N = Math.max(1, Number(opt('n', 20)) || 20);
const NB = Math.max(0, Number(opt('nb', N)) || 0);
const SEED = Number(opt('seed', 1)) || 1;
const MISSION = opt('mission', 'm1');
const zeitMarke = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..*$/, '');
const AUS = path.resolve(opt('aus', path.join('messungen', 'bot-gespraech-' + zeitMarke)));

// Umgebung VOR den Modulen: viele Fragen in kurzer Zeit (Rate), grosszuegige Zeitlimits (Kaltstart des Modells)
if (!process.env.BOT_GESPRAECH_RATE_PRO_MINUTE) process.env.BOT_GESPRAECH_RATE_PRO_MINUTE = '1000';
if (!process.env.BOT_GESPRAECH_ERSTES_TOKEN_MS) process.env.BOT_GESPRAECH_ERSTES_TOKEN_MS = '60000';
if (!process.env.BOT_GESPRAECH_GESAMT_MS) process.env.BOT_GESPRAECH_GESAMT_MS = '90000';
delete process.env.BOT_GESPRAECH_VORWAERMEN;

const { startServer } = require('../server/index.js');
const Physics = require('../shared/physics.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lage = require('../server/bots/gespraech-lage.js');
const Befehle = require('../server/bots/befehle/index.js');
const Annahme = require('../server/bots/annahme.js');
const interior = require('../server/sim/interior.js');
const A = require('./lib/bot-gespraech-auswertung.js');
const WebSocket = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(10); } return !!f(); };
let rs = SEED >>> 0;
const zufall = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
const ganz = (a, b) => a + Math.floor(zufall() * (b - a + 1));
const BOTS = ['b0', 'b1', 'b2'];
const BOT_NAME = { b0: 'Livia', b1: 'Cassius', b2: 'Titus' };

const KURS_FRAGEN = ['Wie ist der Kurs?', 'Welchen Kurs haben wir?', 'Auf welchem Kurs sind wir gerade?', 'Sag mir bitte den aktuellen Kurs.', 'Welchen Kurs fliegen wir, in Grad?', 'Wie lautet unser Kurs?'];
const SCHILD_FRAGEN = ['Wie steht der Schild?', 'Wie stehen die Schilde?', 'Wie sind die Schilde?', 'Wie viel Prozent haben die Schilde in den einzelnen Sektoren?', 'Gib mir den Schildstatus.', 'Wie ist der Zustand der Schilde?'];
const PLAUDER = [
  'Wollen wir nicht mal die Schilde nach Steuerbord legen?', 'Ich würde sagen, halbe Kraft wäre jetzt nicht schlecht.', 'Feuer frei wär jetzt eigentlich nett.', 'Könntest du bei Gelegenheit den Kurs auf Nord ändern?',
  'Ich glaube, volle Kraft voraus wäre gut.', 'Leg die Schilde doch mal aufs Heck, wenn du magst.', 'Wäre schön, wenn du das Ziel markierst.', 'Stopp doch mal das Schiff, ja?',
  'Magst du den Reaktor mal neu starten?', 'Spring doch bitte mal ins nächste System.', 'Repariere doch mal das Triebwerk, ja?', 'Schalt die Waffen doch bitte ab.',
  'Gib mal mehr Energie auf die Schilde.', 'Dreh das Schiff doch mal nach Backbord.', 'Scan doch mal das Ziel, wenn du Zeit hast.', 'Halt bitte etwas Abstand zum Gegner.',
  'Feuer halt, danke dir.', 'Fahr doch mal rückwärts, bitte.', 'Kannst du irgendwo andocken?', 'Mach bitte einfach alles Notwendige, du weißt schon.',
  'Stell die Schilde auf den Bug, das wäre mir lieb.', 'Fliegt doch mal einen Bogen nach Osten.', 'Vielleicht könnten wir das Ziel mal beschießen?', 'Ich hätte gern, dass du Energie auf die Waffen gibst.',
];

// ---------- Dienste ----------
const doppelt = [];
async function dienste() {
  if (!TROCKEN) {
    if (!process.env.OLLAMA_URL) { console.error('OLLAMA_URL fehlt (Tunnel: ssh -N -L 11435:127.0.0.1:11434 sleipnir, dann OLLAMA_URL=http://127.0.0.1:11435).'); process.exit(2); }
    return { stop: async () => {} };
  }
  const { fakeOllama, fakeVoicebox } = require('./lib/bot-gespraech-fakes.js');
  const llm = await fakeOllama().start();
  const vb = await fakeVoicebox().start();
  const wert = (s, re) => { const m = re.exec(s); return m ? m[1] : '0'; };
  llm.antwort = (b) => {
    const sys = b.messages[0].content, frage = b.messages[b.messages.length - 1].content;
    if (/Kurs/.test(frage)) return `Kurs ${wert(sys, /Kurs: (\d+) Grad/)} Grad, Captain.`;
    if (/Schild/.test(frage)) return `Bug ${wert(sys, /Bug (\d+) %/)} Prozent, Steuerbord ${wert(sys, /Steuerbord (\d+) %/)} Prozent, Heck ${wert(sys, /Heck (\d+) %/)} Prozent, Backbord ${wert(sys, /Backbord (\d+) %/)} Prozent.`;
    return 'Gib das bitte als Befehl, Captain.';
  };
  process.env.OLLAMA_URL = 'http://127.0.0.1:' + llm.port;
  process.env.VOICEBOX_URL = 'http://127.0.0.1:' + vb.port;
  delete process.env.VOICEBOX_AUTH;
  return { stop: async () => { await llm.stop(); await vb.stop(); } };
}

// ---------- Zustand ----------
const kopie = (o) => JSON.parse(JSON.stringify(o));
// Teil des Schiffszustands, den ein Befehl veraendern wuerde (Schub, Schilde-Verteilung, Ziel, Technik-Prioritaet, Systeme, Waffen); Kurs und Schildwerte laufen mit der Zeit selbst
const befehlsZustand = (g) => JSON.stringify({ stage: g.ship.helm.stage, autoStop: g.ship.helm.autoStop, alloc: g.ship.shields.alloc, target: g.ship.target, priority: g.ship.priority, systems: g.ship.systems, waffen: g.ship.waffen, sprung: g.ship.jump && g.ship.jump.ready });

// Emitter je Sektor (Index = Sektor 0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord): Zustand ueber die Spielfunktion setzen; die Kappe daraus rechnet space.js (ok = volle Staerke, beschaedigt = halbe, ausgefallen = 0)
const EMITTER_ZUSTAND = ['ok', 'damaged', 'broken'];
function zustandSetzen(g, i) {
  const grad = ganz(0, 359);
  g.ship.angle = (grad - 90) * Math.PI / 180;
  g.ship.turnVel = 0; g.ship.helm.turn = 0;
  for (const s of Object.keys(g.ship.systems)) if (g.ship.systems[s] !== 'ok') { try { interior.setzeZustand(g, s, 'ok'); } catch (e) { /* weiter */ } }
  // Emitter: jede dritte Frage alle intakt, sonst abwechselnd ein beschaedigter bzw. ein ausgefallener (plus ein beschaedigter) Emitter, Sektor zufaellig: alle drei Faelle werden gemessen
  const emitter = ['ok', 'ok', 'ok', 'ok'];
  const phase = i % 3;
  if (phase === 1) emitter[ganz(0, 3)] = 'damaged';
  if (phase === 2) { const a = ganz(0, 3); emitter[a] = 'broken'; const b = (a + ganz(1, 3)) % 4; emitter[b] = 'damaged'; }
  emitter.forEach((st, sek) => { if (st !== 'ok') { try { interior.setzeZustand(g, interior.emitterFor(sek), st); } catch (e) { /* weiter */ } } });
  const voll = g.C.shields.maxPerSector;
  const cap = emitter.map((st) => Math.floor(voll * (st === 'broken' ? 0 : st === 'damaged' ? 0.5 : 1)));   // wie space.js shieldCaps (emitterCap); nur zur Anzeige im Protokoll
  g.ship.shields.current = cap.map((c) => ganz(0, c));   // Schildwerte je Sektor; der naechste Tick klemmt sie auf die tatsaechliche Kappe (gleich der hier berechneten)
  const beschaedigt = [];
  if (i % 4 === 3) {
    const kandidaten = interior.SYSTEM_ORDER.filter((s) => g.ship.systems[s] === 'ok');
    const s = kandidaten[ganz(0, kandidaten.length - 1)];
    if (s) { try { interior.damageSystem(g, s, 'damaged', { debug: true }); beschaedigt.push(s); } catch (e) { /* weiter */ } }
  }
  return { gradGesetzt: grad, emitter: emitter.map((e) => ({ ok: 'ok', damaged: 'beschaedigt', broken: 'ausgefallen' }[e])), kappen: cap, beschaedigt };
}

// ---------- Client ----------
function verbinden(port) {
  const c = { ws: new WebSocket(`ws://127.0.0.1:${port}/ws`), rede: [], spiel: [] };
  c.ws.on('message', (d) => { let m; try { m = JSON.parse(d.toString()); } catch (e) { return; } if (m.t === 'bot.rede') c.rede.push(Object.assign({ _t: process.hrtime.bigint() }, m)); });
  c.send = (o) => c.ws.send(JSON.stringify(o));
  c.offen = new Promise((r) => c.ws.on('open', r));
  return c;
}
const ms = (a, b) => Number(b - a) / 1e6;
const ENDE = ['ende', 'nicht_erreichbar', 'abgelehnt'];

async function gespraech(c, botId, text) {
  const n0 = c.rede.length;
  const t0 = process.hrtime.bigint();
  c.send({ t: 'bot.gespraech', an: botId, text, quelle: 'text' });
  await bis(() => c.rede.length > n0, 5000);
  const gid = c.rede[n0] && c.rede[n0].gid;
  const meine = () => c.rede.slice(n0).filter((m) => m.gid === gid);
  await bis(() => meine().some((m) => ENDE.includes(m.zustand)), 120000);
  const msgs = meine();
  const erste = (z) => { const m = msgs.find((x) => x.zustand === z); return m ? ms(t0, m._t) : null; };
  const ersterTon = msgs.find((x) => x.zustand === 'ton');
  const schluss = msgs.find((x) => ENDE.includes(x.zustand));
  const saetze = msgs.filter((x) => x.zustand === 'satz').map((x) => x.text);
  return {
    saetze, antwort: saetze.join(' '), ausgang: schluss ? schluss.zustand : 'zeit', grund: schluss && schluss.grund || null,
    ton: msgs.filter((x) => x.zustand === 'ton').length, tonMitAudio: msgs.filter((x) => x.zustand === 'ton' && x.audio).length,
    zeiten: { denkt: erste('denkt'), satz1: erste('satz'), ton1: ersterTon ? ms(t0, ersterTon._t) : null, ende: schluss ? ms(t0, schluss._t) : null },
  };
}

const rund = (v, s) => (v == null ? null : Math.round(v * (s || 1)) / (s || 1));
const sek = (v) => (v == null ? '-' : (v / 1000).toFixed(2) + ' s');

(async () => {
  const dst = await dienste();
  const srv = await startServer({ port: 0, quiet: true, noStore: true, roomCode: 'off', worlds: false });
  const g = srv.game;
  for (const r of ['navigation', 'ops', 'technik']) BotSpieler.botHinzufuegen(g, null, r);
  const c = verbinden(srv.port);
  await c.offen;
  c.send({ t: 'hello', clientId: 'MESS1', name: 'Messclient', color: 0 });
  await sleep(150);
  c.send({ t: 'lobbyOpt', startMission: MISSION });
  c.send({ t: 'ready', ready: true });
  if (!(await bis(() => g.phase === 'play', 8000))) { console.error('Partie startet nicht'); process.exit(3); }
  await sleep(1500);   // ein paar Sekunden Spiel, damit die Bots an ihren Stationen sind
  const bots = g.players.filter((p) => p.bot);
  console.log(`Partie laeuft: Mission ${MISSION}, Bots ${bots.map((b) => b.botId + ' ' + b.rolle).join(', ')}, Feinde ${(g.space && g.space.enemies ? g.space.enemies.length : 0)}${TROCKEN ? ', TROCKEN (Fake-Dienste)' : ', echte Dienste ' + process.env.OLLAMA_URL}`);

  // Lauscher: lageAuszug zum Zeitpunkt des Prompt-Baus; Spion auf alles, was ein Befehl waere (Nachrichten des Menschen ausser bot.gespraech, Annahme, Befehlsfunktion; die eigenen Nachrichten der Bots ueber ihre Verbindung zaehlen nicht)
  let letzteLage = null;
  const lageAlt = Lage.lageAuszug;
  Lage.lageAuszug = function (...a) { const r = lageAlt.apply(this, a); letzteLage = kopie(r); return r; };
  const befehlsAufrufe = [];
  const alt = { b: Befehle.befehl, a: Annahme.annehmen, h: g.handleMessage };
  Befehle.befehl = function (...a) { befehlsAufrufe.push('Befehle.befehl'); return alt.b.apply(this, a); };
  Annahme.annehmen = function (...a) { befehlsAufrufe.push('Annahme.annehmen'); return alt.a.apply(this, a); };
  g.handleMessage = function (conn, msg) { if (msg && msg.t !== 'bot.gespraech' && !(conn && conn.player && conn.player.bot)) befehlsAufrufe.push(String(msg.t) + ':' + String(msg.c || msg.befehl || '')); return alt.h.call(this, conn, msg); };

  const protokoll = [];
  let nr = 0;
  const lauf = async (teil, art, frage, botId, extra) => {
    letzteLage = null;
    const vorBefehle = befehlsAufrufe.length;
    const vor = befehlsZustand(g);
    const r = await gespraech(c, botId, frage);
    const nach = befehlsZustand(g);
    const e = Object.assign({ nr: ++nr, teil, art, bot: botId, figur: BOT_NAME[botId], frage, kalt: nr === 1 }, extra || {}, r);
    e.befehlsaufrufe = befehlsAufrufe.slice(vorBefehle);
    e.zustandGleich = vor === nach;
    if (teil === 'a') {
      const l = letzteLage;
      e.soll = l ? (art === 'kurs' ? l.kurs_grad : l.schilde) : null;
      const u = !l || r.ausgang !== 'ende' ? { urteil: 'kein_urteil', genannt: null, abweichungen: [] } : art === 'kurs' ? A.kursUrteil(r.antwort, l.kurs_grad) : A.schildeUrteil(r.antwort, l.schilde);
      Object.assign(e, { urteil: u.urteil, genannt: u.genannt, abweichungen: u.abweichungen, systemeSoll: l && l.systeme });
    } else e.zusagen = A.zusagen(r.antwort);
    protokoll.push(e);
    const kurz = teil === 'a' ? `${e.urteil.padEnd(11)} soll ${JSON.stringify(e.soll)}` : `zusagen ${JSON.stringify(e.zusagen)} befehle ${e.befehlsaufrufe.length} zustandGleich ${e.zustandGleich}`;
    console.log(`#${String(e.nr).padStart(2)} ${teil} ${e.figur.padEnd(7)} "${frage}" -> "${r.antwort}" | ${kurz} | satz ${sek(r.zeiten.satz1)} ton ${sek(r.zeiten.ton1)} ende ${sek(r.zeiten.ende)}${r.ausgang !== 'ende' ? ' [' + r.ausgang + ' ' + (r.grund || '') + ']' : ''}`);
    return e;
  };

  console.log('\n(a) Zustandsstichprobe');
  for (let i = 0; i < N; i++) {
    const art = i % 2 === 0 ? 'kurs' : 'schilde';
    const lst = art === 'kurs' ? KURS_FRAGEN : SCHILD_FRAGEN;
    const frage = lst[Math.floor(i / 2) % lst.length];
    const z = zustandSetzen(g, i);
    await lauf('a', art, frage, BOTS[i % 3], { zustandGesetzt: z });
  }
  console.log('\n(b) Plauderbefehle');
  for (let i = 0; i < NB; i++) await lauf('b', 'plauder', PLAUDER[i % PLAUDER.length], BOTS[i % 3]);

  g.handleMessage = alt.h; Befehle.befehl = alt.b; Annahme.annehmen = alt.a; Lage.lageAuszug = lageAlt;

  // ---------- Auswertung ----------
  const a = protokoll.filter((e) => e.teil === 'a'), b = protokoll.filter((e) => e.teil === 'b');
  const zaehl = (l, u) => l.filter((e) => e.urteil === u).length;
  const R = { n: a.length, richtig: zaehl(a, 'richtig'), unvollstaendig: zaehl(a, 'unvollstaendig'), falsch: zaehl(a, 'falsch'), ausweichend: zaehl(a, 'ausweichend'), keinUrteil: zaehl(a, 'kein_urteil') };
  const kursA = a.filter((e) => e.art === 'kurs'), schA = a.filter((e) => e.art === 'schilde');
  R.kurs = { n: kursA.length, richtig: zaehl(kursA, 'richtig'), unvollstaendig: zaehl(kursA, 'unvollstaendig'), falsch: zaehl(kursA, 'falsch'), ausweichend: zaehl(kursA, 'ausweichend') };
  R.schilde = { n: schA.length, richtig: zaehl(schA, 'richtig'), unvollstaendig: zaehl(schA, 'unvollstaendig'), falsch: zaehl(schA, 'falsch'), ausweichend: zaehl(schA, 'ausweichend') };
  const emZ = schA.map((e) => (e.zustandGesetzt && e.zustandGesetzt.emitter) || []);
  R.emitter = { alleOk: emZ.filter((z) => z.every((x) => x === 'ok')).length, mitBeschaedigt: emZ.filter((z) => z.includes('beschaedigt')).length, mitAusgefallen: emZ.filter((z) => z.includes('ausgefallen')).length };   // Schildfragen je Emitterfall (W6)
  const bR = { n: b.length, befehlsaufrufe: b.reduce((s, e) => s + e.befehlsaufrufe.length, 0), zustandUngleich: b.filter((e) => !e.zustandGleich).length, mitZusage: b.filter((e) => e.zusagen.length).length, ohneAntwort: b.filter((e) => e.ausgang !== 'ende').length };
  const lat = (l, k) => { const w = l.map((e) => e.zeiten[k]).filter((x) => x != null); return { n: w.length, median: rund(A.median(w)), p90: rund(A.perzentil(w, 90)), max: rund(Math.max(...w, 0)) }; };
  const warm = protokoll.filter((e) => !e.kalt), kalt = protokoll.filter((e) => e.kalt);
  const L = { alle: {}, warm: {}, kalt: kalt[0] ? kalt[0].zeiten : null };
  for (const k of ['denkt', 'satz1', 'ton1', 'ende']) { L.alle[k] = lat(protokoll, k); L.warm[k] = lat(warm, k); }

  fs.mkdirSync(AUS, { recursive: true });
  fs.writeFileSync(path.join(AUS, 'protokoll.jsonl'), protokoll.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const md = [];
  md.push(`# Messung Bot-Gespraech (BOT-05 B3) ${zeitMarke}`, '', `Modus ${TROCKEN ? 'TROCKEN (Fake-Dienste)' : 'echt'}, Mission ${MISSION}, n = ${N}, nb = ${NB}, Seed ${SEED}, Ollama ${process.env.OLLAMA_URL}, Modell ${process.env.BOT_GESPRAECH_MODELL || 'gemma4:26b-a4b-it-q4_K_M'}.`, '');
  md.push('## (a) Zustandsstichprobe', '', `richtig ${R.richtig} / unvollstaendig ${R.unvollstaendig} / falsch ${R.falsch} / ausweichend ${R.ausweichend} / ohne Antwort ${R.keinUrteil} von ${R.n}. Kurs: ${JSON.stringify(R.kurs)}. Schilde: ${JSON.stringify(R.schilde)}.`, '');
  md.push('| # | Bot | Frage | Soll | Antwort (woertlich) | Urteil | abweichend | satz | ton | ende |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const e of a) md.push(`| ${e.nr} | ${e.figur} | ${e.frage} | ${JSON.stringify(e.soll)}${e.zustandGesetzt && e.zustandGesetzt.emitter && e.zustandGesetzt.emitter.some((x) => x !== 'ok') ? ' Emitter ' + e.zustandGesetzt.emitter.join('/') : ''}${e.systemeSoll && e.systemeSoll.length ? ' Systeme ' + e.systemeSoll.map((s) => s.system + ' ' + s.zustand).join(',') : ''} | ${(e.antwort || '(' + e.ausgang + ')').replace(/\|/g, '/')} | ${e.urteil} | ${JSON.stringify(e.abweichungen)} | ${sek(e.zeiten.satz1)} | ${sek(e.zeiten.ton1)} | ${sek(e.zeiten.ende)} |`);
  md.push('', '## (b) Plauderbefehle', '', `Befehlsaufrufe ${bR.befehlsaufrufe} (Soll 0), Zustand ungleich in ${bR.zustandUngleich} von ${bR.n}, Antworten mit Zusage/Ausfuehrungsbehauptung ${bR.mitZusage} von ${bR.n}, ohne Antwort ${bR.ohneAntwort}.`, '');
  md.push('| # | Bot | Befehl im Plauderton | Antwort (woertlich) | Zusage-Treffer | Befehlsaufrufe | Zustand gleich |', '|---|---|---|---|---|---|---|');
  for (const e of b) md.push(`| ${e.nr} | ${e.figur} | ${e.frage} | ${(e.antwort || '(' + e.ausgang + ')').replace(/\|/g, '/')} | ${e.zusagen.join('; ') || '-'} | ${e.befehlsaufrufe.join(',') || '0'} | ${e.zustandGleich ? 'ja' : 'NEIN'} |`);
  md.push('', '## (c) Latenz in ms (Zeit seit Senden von bot.gespraech)', '', '| Messwert | alle: Median | alle: p90 | ohne Kaltstart: Median | ohne Kaltstart: p90 | Kaltstart (Gespraech 1) |', '|---|---|---|---|---|---|');
  for (const k of ['denkt', 'satz1', 'ton1', 'ende']) md.push(`| ${k} | ${L.alle[k].median} | ${L.alle[k].p90} | ${L.warm[k].median} | ${L.warm[k].p90} | ${L.kalt ? rund(L.kalt[k]) : '-'} |`);
  fs.writeFileSync(path.join(AUS, 'protokoll.md'), md.join('\n') + '\n');

  console.log('\n=== Ergebnis ===');
  console.log(`(a) richtig ${R.richtig}, unvollstaendig ${R.unvollstaendig}, falsch ${R.falsch}, ausweichend ${R.ausweichend}, ohne Antwort ${R.keinUrteil} von ${R.n}  (Kurs ${JSON.stringify(R.kurs)}, Schilde ${JSON.stringify(R.schilde)})`);
  console.log(`    Schildfragen nach Emitterzustand: alle intakt ${R.emitter.alleOk}, mit beschaedigtem ${R.emitter.mitBeschaedigt}, mit ausgefallenem ${R.emitter.mitAusgefallen}`);
  for (const e of a.filter((x) => x.urteil === 'falsch' || x.urteil === 'unvollstaendig')) console.log(`    ${e.urteil} #${e.nr} ${e.figur} "${e.frage}": Soll ${JSON.stringify(e.soll)}, Antwort "${e.antwort}"`);
  console.log(`(b) Befehlsaufrufe ${bR.befehlsaufrufe}, Zustand ungleich ${bR.zustandUngleich}, Zusagen ${bR.mitZusage} von ${bR.n}, ohne Antwort ${bR.ohneAntwort}`);
  for (const e of b.filter((x) => x.zusagen.length)) console.log(`    Zusage #${e.nr} ${e.figur} "${e.frage}": "${e.antwort}" [${e.zusagen.join('; ')}]`);
  console.log('(c) Latenz ms, ohne Kaltstart (Median / p90) | alle | Kaltstart');
  for (const k of ['denkt', 'satz1', 'ton1', 'ende']) console.log(`    ${k.padEnd(6)} ${L.warm[k].median} / ${L.warm[k].p90} | ${L.alle[k].median} / ${L.alle[k].p90} | ${L.kalt ? rund(L.kalt[k]) : '-'}`);
  console.log('Protokoll: ' + AUS);

  c.ws.close();
  await srv.close();
  await dst.stop();
  const fehler = R.keinUrteil + bR.befehlsaufrufe + bR.zustandUngleich;
  process.exit(TROCKEN && (R.falsch || R.unvollstaendig || R.ausweichend || fehler) ? 1 : 0);
})().catch((e) => { console.error('Abbruch:', e && e.stack || e); process.exit(1); });
