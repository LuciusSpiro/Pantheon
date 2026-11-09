'use strict';
// LIV-01 D: Live-Laeufer fuer simulierte Bot-Abende mit dem ECHTEN Spielleiter (Claude). Derselbe Bot-Crew wie tools/spiel-faden.js (drei WebSocket-Clients am echten Server, tools/lib/bot-crew.js),
// aber ohne Mock-Plan: die Freie Fahrt Sund laeuft ueber echte Spruenge, die Abenteuer-Angebote im Brett (world.abenteuer.angebote) stammen vom Spielleiter (Komposition durch Claude, Rueckfall ohne Modell),
// die Crew nimmt sie an (abenteuer.annehmen) und spielt jedes angenommene Abenteuer so weit der Bot es kann (tools/lib/bot-beats.js); was er nicht kann, steht im Index mit Ausgang.
//   node tools/live-abend.js --seed 7 --out <ordner>                 Mock-Spielleiter (offline, kostet nichts)
//   node tools/live-abend.js --live --seed 7,23 --out <ordner>        echter Claude: nur mit LLM_LIVE=1 UND gefundener CLI, sonst "nicht gemessen" (Exit 0). Das Werkzeug setzt LLM_LIVE nie selbst.
//   Die Umgebung des Aufrufers gilt: SPIELLEITER_LLM (--live setzt nur das), LLM_LIVE, CLAUDE_TOKEN_BUDGET, CLAUDE_CLI, LLM_*, OLLAMA_*. LAGE_SPIELLEITER, REISE_EREIGNISSE und FAEDEN stehen auf 1, wenn nicht anders gesetzt.
//   --seed <n[,n...]>     ein Abend je Seed (Standard 7); jeder Abend ist ein eigener Prozess (eigener Token-Zaehler: CLAUDE_TOKEN_BUDGET gilt je Abend)
//   --dauer <s>           Hoechstdauer je Abend in Sekunden (Standard 900)          --sprunglimit <n>   hoechstens so viele gelungene Spruenge (Standard: keine Grenze)
//   --abenteuer <n>       hoechstens so viele Abenteuer annehmen und spielen (Standard 4 = der Deckel der Komposition je Sitzung)       --abenteuer-dauer <s>   Hoechstdauer je Abenteuer (Standard 420)
//   --plaene <n>          deckelt die Aufrufe des Lage- und des Abenteuer-Spielleiters je Abend (Kostenbremse, nie ueber die Werte des Spiels hinaus)
//   --out <ordner>        Wurzel der Ablage (relativ zum Aufrufer, NIE im Repo, Standard <Temp>/pantheon-messung); jeder Lauf legt einen neuen Ordner abend-<modus>-<Zeit> an, nichts wird geloescht
//   --mitschnitt-dir <o>  Wurzel der Mitschnitte (Standard <lauf>/abend-<seed>/mitschnitt); der Mitschnitt ist immer an (MITSCHNITT=1)
//   --freigeben           der Bot-Captain sendet kontingent.freigeben, wenn die Kontingent-Meldung kommt (Test des Knopfwegs ohne Browser)
//   --ohne-testhelfer     Szenen-Beats (konvoi, geleit, raumschlacht, verfolgung, befreiung) NICHT per Testhelfer spielen: sie laufen in die Frist     --ohne-nachhilfe   der Bot bringt wartende Beats nie selbst weiter
//   --rueckfall-nach <s>  Angebote des Rueckfalls (Anschluss-Garantie, kein Claude-Plan) nimmt der Bot erst, wenn der Spielleiter nichts mehr anbietet (Deckel erschoepft, Kontingent erreicht) oder so lange nichts Neues kam (Standard 180)
//   --geduld <s>          so lange wartet der Bot auf den Spielleiter, bevor er einen faelligen Beat selbst startet (kuenstlich, Standard 45)   --grenzabstand <s>   Mindestabstand der Taetigkeitsgrenzen (Standard 4)
// Exit 0 (auch bei "nicht gemessen"), 1 Fehler im Lauf (Abend abgestuerzt oder Serverfehler), 2 falscher Aufruf.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const START_CWD = process.cwd();
process.chdir(path.join(__dirname, '..'));
const Ablage = require('./messe-ablage.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const NAMEN = ['Ada', 'Bo', 'Cem'];
const nn = (n) => String(n).padStart(2, '0');
const f = Ablage.fmt;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Namen der Bots nie im Dokument: ersetzt durch Spieler 1..3 (Ganzwort); zaehlt die Ersetzungen
const NAMENSFILTER = new RegExp('\\b(' + NAMEN.join('|') + ')\\b', 'g');
let ersetzt = 0;
const ohneNamen = (t) => String(t == null ? '' : t).replace(NAMENSFILTER, (m) => { ersetzt++; return 'Spieler ' + (NAMEN.indexOf(m) + 1); });

// ---------- Aufruf lesen
function aufrufLesen() {
  const fehler = (m) => { console.error(m); process.exit(2); };
  const o = { intern: flag('intern'), live: flag('live'), mock: flag('mock'), freigeben: flag('freigeben'), testhelfer: !flag('ohne-testhelfer'), nachhilfe: !flag('ohne-nachhilfe') };
  if (o.live && o.mock) fehler('--live und --mock schliessen sich aus');
  const zahl = (n, min, max, std, ganz) => {
    if (!args.includes('--' + n)) return std;
    const v = Number(wert(n));
    if (!(Number.isFinite(v) && v >= min && v <= max && (!ganz || Number.isInteger(v)))) fehler(`--${n}: ${ganz ? 'ganze ' : ''}Zahl ${min} bis ${max}`);
    return v;
  };
  const sd = wert('seed');
  if (args.includes('--seed') && (sd === undefined || sd.startsWith('--'))) fehler('--seed: Zahl oder Liste n,n,...');
  o.seeds = (sd === undefined ? '7' : sd).split(',').map((x) => Number(x.trim()));
  if (!o.seeds.length || o.seeds.some((n) => !Number.isInteger(n) || n < 1 || n > 2147483647) || new Set(o.seeds).size !== o.seeds.length) fehler('--seed: ganze Zahlen 1 bis 2147483647, jeder Seed hoechstens einmal');
  o.dauer = zahl('dauer', 5, 7200, 900); o.sprunglimit = zahl('sprunglimit', 1, 1000, 0, true); o.abenteuer = zahl('abenteuer', 1, 12, 4, true); o.rueckfallNach = zahl('rueckfall-nach', 0, 3600, 180);
  o.abenteuerDauer = zahl('abenteuer-dauer', 5, 3600, 420); o.plaene = zahl('plaene', 1, 12, 0, true);
  o.geduld = zahl('geduld', 0, 3600, 45); o.grenzabstand = zahl('grenzabstand', 0, 600, 4);
  o.abendDir = wert('abend-dir'); o.seed = Number(wert('seed'));
  if (args.includes('--out')) {
    const a = wert('out');
    try { o.wurzel = Ablage.wurzelPruefen(a && !a.startsWith('--') ? a : '', START_CWD); } catch (e) { fehler(e.message); }
  } else o.wurzel = path.join(os.tmpdir(), 'pantheon-messung');
  if (!o.intern) { try { Ablage.wurzelPruefen(o.wurzel, START_CWD); } catch (e) { fehler(e.message); } }
  const md = args.includes('--mitschnitt-dir') ? wert('mitschnitt-dir') : null;
  if (args.includes('--mitschnitt-dir') && (!md || md.startsWith('--'))) fehler('--mitschnitt-dir braucht einen Ordner');
  if (md) { try { o.mitschnittDir = Ablage.wurzelPruefen(md, START_CWD); } catch (e) { fehler(e.message.replace(/^--out /, '--mitschnitt-dir ')); } }
  return o;
}

// =====================================================================================================================================================
// Ein Abend (Kindprozess): Server, drei Clients, Bot-Schleife, Ablage der Rohdaten (ergebnis.json, plaene/, regie/, mitschnitt/)
// =====================================================================================================================================================
async function abend(o) {
  const dir = o.abendDir;
  const regieDir = path.join(dir, 'regie');
  fs.mkdirSync(dir, { recursive: false });
  // Umgebung des Spiels: die des Aufrufers gilt; nur Fehlendes wird ergaenzt, nie live/LLM_LIVE gesetzt
  for (const kk of ['LAGE_SPIELLEITER', 'REISE_EREIGNISSE', 'FAEDEN']) if (process.env[kk] === undefined || process.env[kk] === '') process.env[kk] = '1';
  if (o.live) process.env.SPIELLEITER_LLM = 'live'; else if (!process.env.SPIELLEITER_LLM) process.env.SPIELLEITER_LLM = 'mock';
  if (o.mock) process.env.SPIELLEITER_LLM = 'mock';
  process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = regieDir;
  const mitWurzel = o.mitschnittDir ? path.join(o.mitschnittDir, 'seed-' + o.seed) : path.join(dir, 'mitschnitt');
  const MitLauf = require('./lib/mitschnitt-lauf.js');
  MitLauf.einschalten(['--mitschnitt', '--mitschnitt-dir', mitWurzel]);
  const modus = String(process.env.SPIELLEITER_LLM).toLowerCase() === 'live' ? 'live' : 'mock';

  const WebSocket = require('ws');
  const { startServer } = require('../server/index.js');
  const Faden = require('../server/sim/faden.js');
  const FD = require('../server/sim/faden-daten.js');
  const Kriegslage = require('../server/sim/kriegslage.js');
  const Sektoren = require('../shared/sektoren.js');
  const Sprung = require('../server/sim/sprung.js');
  const Kontingent = require('../server/sim/kontingent.js');
  const LLM = require('../server/mission/llm.js');
  const Regielog = require('../server/mission/regielog.js');
  const Bot = require('./lib/bot-crew.js');
  const Beats = require('./lib/bot-beats.js');
  const CODE = 'LIVA';
  const protokoll = [];
  const t0 = Date.now();
  const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); const z = `${t}  ${s}`; protokoll.push(z); console.log(`[Abend ${o.seed}] ${z}`); };

  const budget0 = LLM.budget();
  const wDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-abend-welt-'));   // Spielstand (enthaelt die Namen der Bots) im Temp-Ordner, nicht in der Ablage und nie im Repo
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: wDir, debug: true, roomCode: CODE });
  const g = srv.game, port = srv.port;
  g.fixedSeed = o.seed; g.reset();   // der Seed des Abends (Weltstand und Sim); vor dem Beitritt der Clients
  const kz = {};
  const k = (...arten) => { for (const a of arten) kz[a] = (kz[a] || 0) + 1; MitLauf.kuenstlich(g, ...arten); };
  MitLauf.anmelden(g, { werkzeug: 'live-abend', modus: 'faeden', seed: g.seed, crew: NAMEN.length, quelle: 'bot',
    regel: 'Brett: Angebot annehmen (zwei Clients zugleich, die erste Antwort gilt); Bitte: Option annehmen, sonst die erste; Notruf der Reise: hinspringen, wenn hoechstens 3 Spruenge; Beats: Ort anfliegen, lesen, sprengen; Szenen: Gegner per Testhelfer (kuenstlich), mit --ohne-testhelfer gar nicht' });
  zeile(`Server auf Port ${port}, Modus ${modus}, Seed ${g.seed}`);
  const cl = [];
  for (let i = 0; i < 3; i++) cl.push(await Bot.client(WebSocket, port, CODE, { clientId: 'ABC'[i], name: NAMEN[i], color: i }, NAMEN[i], NAMEN));
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  const w = Bot.werkzeug({ g, cl, zeile, k });
  const sl0 = () => g.lageSpielleiter;
  zeile(`drei Clients im Spiel: ${g.players.filter((p) => p.connected).length} verbunden, Phase ${g.phase}, Lage-Spielleiter ${sl0() && !sl0().disposed ? 'aktiv (Modus ' + sl0().mode + ')' : 'NICHT aktiv'}`);

  // ---------- Beobachtung des Spielleiters: jede Anfrage mit Prompt, Antwort, Kosten (Zuordnung ueber kind + input.nr, wie messe-lage)
  const calls = [];
  let gewrappt = false;
  const wrap = () => {
    const sl = sl0();
    if (!sl || gewrappt || sl.disposed) return;
    gewrappt = true;
    const llm = sl.getLlm();
    for (const name of ['ask', 'eskaliere']) {
      if (typeof llm[name] !== 'function') continue;
      const a0 = llm[name].bind(llm);
      llm[name] = async (kind, input, opt) => {
        const rec = { seq: calls.length + 1, kind, nr: input && input.nr, grenze: input && input.art, tick: g.weltsim ? g.weltsim.tickZahl : null, spielzeit: g.time, start: new Date().toISOString(), wall0: Date.now(), prompt: input && input.prompt, system: input && input.system, eskaliert: name === 'eskaliere' };
        calls.push(rec);
        try {
          const r = await a0(kind, input, opt);
          Object.assign(rec, { wall_s: (Date.now() - rec.wall0) / 1000, antwort: { text: r.text || '', usage: r.usage, tokens: r.tokens, cost: r.cost, sec: r.sec, key: r.key, cli: r.cli ? r.cli.quelle : null, anbieter: r.anbieter || null, modell: r.modell || r.modelId || null } });
          return r;
        } catch (e) { Object.assign(rec, { wall_s: (Date.now() - rec.wall0) / 1000, fehler: (e.code || 'EXIT') + ': ' + String(e.message).slice(0, 300) }); throw e; }
      };
    }
    if (o.plaene) {   // Kostenbremse: je Instanz eine Kopie der Werte
      sl.W = Object.assign({}, sl.W, { deckel_je_sitzung: Math.min(sl.W.deckel_je_sitzung, o.plaene) });
      if (sl.abenteuer) sl.abenteuer.W = Object.assign({}, sl.abenteuer.W, { deckel_je_sitzung: Math.min(sl.abenteuer.W.deckel_je_sitzung, o.plaene) });
    }
  };
  const busy = () => { const sl = sl0(); return !!sl && !sl.disposed && (sl.zustand === 'laeuft' || sl.zustand === 'angefragt' || sl.inbox.length > 0 || (!!sl.abenteuer && (sl.abenteuer.zustand !== 'idle' || sl.abenteuer.inbox.length > 0))); };

  // ---------- Taetigkeitsgrenze, gebremst: nie schneller als der Spielleiter antworten kann und nie dichter als --grenzabstand (eine Grenze zaehlt als Taetigkeit: die Fristen der Beats laufen darueber)
  let letzteGrenze = 0, grenzen = 0;
  const grenze = () => {
    if (busy() || Date.now() - letzteGrenze < o.grenzabstand * 1000) return false;
    letzteGrenze = Date.now(); grenzen++;
    k('grenze-gesetzt');   // die Grenze (Ende einer Sim-Szene) wird gesetzt, nicht gespielt (wie spiel-faden und messe-lage)
    Kriegslage.tick(g, 'spiel');
    g.lageGrenze('szene_ende');
    return true;
  };
  const ereignisse = { bitten: [] };
  const ereignis = (art, d) => { if (art === 'bitte') ereignisse.bitten.push(Object.assign({ spielzeit: g.time, wall: Date.now() }, d)); };
  const B = Beats.neu({ g, cl, w, zeile, k, kz, opts: { testhelfer: o.testhelfer }, grenze, ereignis });

  // ---------- Beobachter: Angebote (Zeit des ersten Sehens), Notrufe der Reise, Kontingent
  const brett = (c) => (c.abenteuer && c.abenteuer.angebote) || [];
  const angebote = new Map();   // nr -> { nr, id, titel, typen, von, sichtbar: { spielzeit, wall }, angenommen, ... }
  const notrufe = new Map();
  const kont = { erreicht: false, spielzeit: null, wall: null, used: null, limit: null, schwelle: null, funk: null, freigabe: null };
  const beobachte = () => {
    wrap();
    const F = g.weltsim && g.weltsim.faeden;
    if (F) for (const a of F.abenteuerAngebote || []) {
      if (angebote.has(a.nr)) continue;
      const e = brett(cl[0]).find((x) => x.id === 'a' + a.nr);
      angebote.set(a.nr, { nr: a.nr, id: 'a' + a.nr, ref: a.ref, hex: a.hex, titel: e ? e.titel : null, typen: a.vorlage && a.vorlage.beats ? a.vorlage.beats.map((b) => b.typ) : [], von: e ? e.von : null, sichtbar: { spielzeit: g.time, wall: Date.now() }, angenommen: null, faden: null, ausgang: null });
    }
    for (const [nr, a] of angebote) if (!a.titel) { const e = brett(cl[0]).find((x) => x.id === 'a' + nr); if (e) { a.titel = e.titel; a.von = e.von; } }
    const R = g.weltsim && g.weltsim.reise;
    if (R && Array.isArray(R.offen)) {
      for (const n of R.offen) if (!notrufe.has(n.nr)) notrufe.set(n.nr, { nr: n.nr, id: n.id, hex: n.hex, erschienen: { spielzeit: g.time, wall: Date.now() }, ausgang: 'offen', beantwortet: null });
      for (const [nr, n] of notrufe) if (n.ausgang === 'offen' && !R.offen.some((x) => x.nr === nr)) { n.ausgang = 'beendet'; n.beendet = { spielzeit: g.time, wall: Date.now() }; }
    }
    if (!kont.erreicht && Kontingent.erreicht()) {
      const b = LLM.budget();
      Object.assign(kont, { erreicht: true, spielzeit: g.time, wall: Date.now(), used: b.used, limit: b.limit, schwelle: Kontingent.schwelle() });
      zeile(`KONTINGENT erreicht: ${b.used} von ${b.limit} (Schwelle ${kont.schwelle}); der Spielleiter antwortet ab jetzt aus der Konserve`);
    }
    if (kont.erreicht && !kont.funk) { const m = cl[0].radioAlle.find((x) => /Kontingent/.test(x.text)); if (m) kont.funk = { von: m.von, text: m.text, wall: m.wall }; }
  };
  let freigabeLaeuft = false;
  const freigeben = async () => {
    if (!o.freigeben || !kont.erreicht || kont.freigabe || freigabeLaeuft || !kont.funk) return;
    freigabeLaeuft = true;
    zeile('Bot-Captain sendet kontingent.freigeben (Captain-Konsole)');
    await w.konsole('captain');
    const n = cl[0].kontAntw.length, t1 = Date.now();
    cl[0].send({ t: 'cmd', c: 'kontingent.freigeben' });
    await w.wartenAuf(() => cl[0].kontAntw.length > n, 50);
    const a = cl[0].kontAntw[n] || null;
    kont.freigabe = { gesendet_wall: t1, antwort: a ? { ok: a.ok, code: a.code || null, text: a.text || null } : null, nach_s: a ? (a.wall - t1) / 1000 : null, limit_danach: LLM.budget().limit };
    zeile('Freigabe: ' + (a ? (a.ok ? 'ok, Limit ' + kont.freigabe.limit_danach : (a.code || 'abgelehnt')) : 'keine Antwort'));
  };

  // ---------- Erkundung (echte Spruenge) und Notrufe der Reise
  let zs = (o.seed * 2654435761) >>> 0;
  const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let x = zs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const nachbarn = () => {
    const von = w.hierHex(), out = [];
    for (const h of Sektoren.nachbarn(von)) {
      if (!Sektoren.spielbar(h) || !Sektoren.ortVonHex(h) || Sektoren.istLeerraum(h)) continue;
      g.explore.markBoje(Sektoren.kanteId(von, h));
      if (Sprung.hexGrund(g, von, h)) continue;
      out.push(h);
    }
    return out;
  };
  const szeneRaeumen = async () => { for (let i = 0; i < 600 && (g.simSzene || (g.space.enemies && g.space.enemies.length && g.fadenSzene)); i++) { B.alleGegner(); await sleep(100); } };
  const notrufAntworten = async () => {
    const R = g.weltsim && g.weltsim.reise;
    if (!R || !Array.isArray(R.offen)) return false;
    for (const n of R.offen.slice()) {
      const weg = w.wegNach(n.hex);
      if (!weg || weg.length > 3 || notrufe.get(n.nr).versucht) continue;
      notrufe.get(n.nr).versucht = true;
      zeile(`Notruf ${n.nr} (${n.id}) bei ${Sektoren.hexName(n.hex)}: die Crew springt hin (${weg.length} Sprung/Spruenge)`);
      const ok = await w.springe(n.hex);
      await sleep(500);
      const nt = notrufe.get(n.nr);
      if (ok && !R.offen.some((x) => x.nr === n.nr)) { nt.ausgang = 'beantwortet'; nt.beantwortet = { spielzeit: g.time, wall: Date.now() }; }
      await szeneRaeumen();
      return true;
    }
    return false;
  };
  const erkunde = async () => {
    const kand = nachbarn(); if (!kand.length) return false;
    const ziel = kand[Math.floor(zufall() * kand.length)];
    zeile(`Erkundung: Sprung nach ${Sektoren.hexName(ziel)}`);
    const ok = await w.springe(ziel);
    await szeneRaeumen();
    return ok;
  };

  // ---------- Abenteuer annehmen und spielen
  const abenteuerListe = [];
  const laufend = () => (g.weltsim.faeden.liste || []).find((x) => x.plan && x.phase !== 'abgeschlossen') || null;
  async function annehmen(a) {
    const idx = abenteuerListe.length;
    const a1 = cl[idx % 3], a2 = cl[(idx + 1) % 3];
    const n1 = a1.abAntw.length, n2 = a2.abAntw.length, wall = Date.now(), sz = g.time;
    a1.send({ t: 'cmd', c: 'abenteuer.annehmen', id: a.id }); a2.send({ t: 'cmd', c: 'abenteuer.annehmen', id: a.id });
    await w.wartenAuf(() => a1.abAntw.length > n1 && a2.abAntw.length > n2, 50);
    const r = [a1.abAntw[n1], a2.abAntw[n2]].filter(Boolean);
    a.angenommen = { spielzeit: sz, wall, reaktion_spielzeit_s: sz - a.sichtbar.spielzeit, reaktion_s: (wall - a.sichtbar.wall) / 1000, antworten: r.map((x) => (x.ok ? 'ok' : x.code)) };
    const fd = (g.weltsim.faeden.liste || []).find((x) => x.plan && x.vorlage === a.ref) || null;
    a.faden = fd ? fd.id : null;
    zeile(`Angebot ${a.id} „${a.titel}“ (${a.typen.join(' > ')}) angenommen nach ${f(a.angenommen.reaktion_s, 10)} s (${a1.name} und ${a2.name} zugleich: ${a.angenommen.antworten.join(' / ')}), Abenteuer ${a.faden || 'KEINS'}`);
    return fd;
  }
  async function spieleAbenteuer(fd, a) {
    const v = FD.vorlage(fd.vorlage);
    const rec = { angebot: a.nr, faden: fd.id, titel: a.titel, typen: v.beats.map((b) => b.typ), nsc: null, beats: [], ausgang: null, nachhilfe: [], kuenstlich: {}, start: Date.now(), dauer_s: null, faellig_seit: null };
    abenteuerListe.push(rec);
    const kz0 = Object.assign({}, kz);
    const bis = Date.now() + o.abenteuerDauer * 1000;
    let geplant = 0;
    while (fd.phase !== 'abgeschlossen' && Date.now() < bis && !gesamtEnde()) {
      beobachte();
      if (fd.phase === 'laeuft') { geplant = 0; rec.faellig_seit = null; const r = await B.spieleBeat(fd); rec.beats.push(r); zeile(`Beat ${r.typ}: ${r.wie}, Ausgang ${r.ausgang}${r.notiz ? ' (' + r.notiz + ')' : ''}${Object.keys(r.kuenstlich).length ? ' [kuenstlich: ' + Object.keys(r.kuenstlich).join(', ') + ']' : ''}`); continue; }
      await B.leerlauf(150);
      if (fd.zaehler >= fd.abstand) {
        if (rec.faellig_seit === null) rec.faellig_seit = Date.now();
        if (o.nachhilfe && !busy() && Date.now() - rec.faellig_seit >= o.geduld * 1000 && Date.now() - geplant >= o.geduld * 1000) {
          geplant = Date.now();
          const r = B.nachhilfe(fd);
          rec.nachhilfe.push({ beat: B.beatVon(fd).typ, ok: !!(r && r.ok), grund: r && r.grund || null, nach_s: (Date.now() - rec.faellig_seit) / 1000 });
          zeile(`Der Spielleiter hat Beat ${B.beatVon(fd).typ} nicht gestartet (faellig seit ${f((Date.now() - rec.faellig_seit) / 1000, 10)} s): der Bot startet ihn selbst (kuenstlich): ${r && r.ok ? 'ok' : 'abgelehnt ' + (r && r.grund)}`);
        }
      }
    }
    await sleep(300);
    rec.dauer_s = (Date.now() - rec.start) / 1000;
    rec.ausgang = fd.phase === 'abgeschlossen' ? (fd.ausgang && fd.ausgang.art) || 'abgeschlossen' : 'offen beim Ende (' + fd.phase + ', Beat ' + B.beatVon(fd).typ + ')';
    rec.nsc_status = fd.nsc.status; rec.gedaechtnis = fd.nsc.gedaechtnis.map((x) => x.ereignis);
    for (const [kk, n] of Object.entries(kz)) if (n > (kz0[kk] || 0)) rec.kuenstlich[kk] = n - (kz0[kk] || 0);
    a.ausgang = 'gespielt';
    zeile(`Ende Abenteuer ${fd.id}: ${rec.ausgang} nach ${f(rec.dauer_s, 10)} s, kuenstlich ${JSON.stringify(rec.kuenstlich)}`);
  }

  // ---------- die Schleife des Abends
  let abbruch = null;
  const gesamtEnde = () => Date.now() - t0 > o.dauer * 1000 || (o.sprunglimit && w.stat.spruenge >= o.sprunglimit);
  let letzterSprung = 0, letzterAbschluss = Date.now();
  const planDes = (nr) => !!(g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries.some((e) => e.art === 'abenteuer_bauplan' && e.ausgang === 'gueltig' && e.plan && e.plan.angebot === nr));   // Angebot aus einem Plan-Aufruf (sonst Rueckfall)
  try {
    while (!gesamtEnde()) {
      beobachte(); await freigeben();
      const offene = [...angebote.values()].filter((a) => !a.angenommen && brett(cl[0]).some((x) => x.id === a.id));
      const vomSpielleiter = offene.filter((a) => planDes(a.nr));
      const sa = sl0() && sl0().abenteuer;
      const rueckfallFrei = kont.erreicht || (!!sa && sa.aufrufe >= sa.W.deckel_je_sitzung && !busy()) || Date.now() - letzterAbschluss > o.rueckfallNach * 1000;   // Rueckfall-Angebote erst, wenn vom Spielleiter nichts mehr kommt
      const wahl = vomSpielleiter[0] || (rueckfallFrei ? offene[0] : null);
      if (wahl && !laufend() && abenteuerListe.length < o.abenteuer) {
        const a = wahl;
        const fd = await annehmen(a);
        if (fd) await spieleAbenteuer(fd, a); else a.ausgang = 'Annahme ohne Abenteuer';
        letzterAbschluss = Date.now();
        continue;
      }
      if (abenteuerListe.length >= o.abenteuer && !laufend()) break;
      await B.leerlauf(150);
      const frei = !busy() && !laufend();
      if (frei && Date.now() - letzterSprung > 20000 && !offene.length) {
        letzterSprung = Date.now();
        if (!(await notrufAntworten())) await erkunde();
        letzterSprung = Date.now();
      }
    }
    // Ausklang: laufende Anfragen des Spielleiters abwarten, damit jede Anfrage mit Antwort in der Ablage steht (hoechstens 3 Minuten)
    for (let i = 0; i < 1800 && busy(); i++) { beobachte(); await sleep(100); }
    beobachte(); await freigeben();
  } catch (e) { abbruch = 'Fehler im Lauf: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); zeile(abbruch); }

  // ---------- Ablage
  const dauer_s = (Date.now() - t0) / 1000;
  const budget1 = LLM.budget();
  for (const x of cl) { try { x.ws.close(); } catch (e) { /* egal */ } }
  let logbuch = [];
  if (g.lageRegie && g.lageRegie.log && g.lageRegie.log.file) {
    const wid = path.basename(g.lageRegie.log.file).replace(/\.jsonl$/, '');
    try { logbuch = Regielog.read(path.dirname(g.lageRegie.log.file), wid).entries; } catch (e) { logbuch = []; }
  }
  const mitOrdner = MitLauf.beenden(g, (s) => zeile(s));
  const AP = require('../server/sim/abenteuer-prompt.js');
  const LagePrompt = require('../server/sim/lage-prompt.js');
  // Mitschnitt: Gruppen (Abenteuer) mit ihrer Angebotsnummer, Ordner und mission.md
  let gruppen = [];
  if (mitOrdner && fs.existsSync(path.join(mitOrdner, 'verlauf.json'))) { try { gruppen = JSON.parse(fs.readFileSync(path.join(mitOrdner, 'verlauf.json'), 'utf8')).gruppen || []; } catch (e) { gruppen = []; } }
  const ordnerListe = mitOrdner && fs.existsSync(mitOrdner) ? fs.readdirSync(mitOrdner, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  const missionVon = (gr) => {
    const d = ordnerListe.find((n) => n.endsWith('_' + gr.kennung));
    return d && fs.existsSync(path.join(mitOrdner, d, 'mission.md')) ? path.join(mitOrdner, d, 'mission.md') : null;
  };
  // Plaene: je Anfrage-Nummer (kind + nr) eine Datei; Zuordnung Plan -> Angebot ueber das Logbuch (abenteuer_bauplan gueltig: plan.nr, plan.angebot), Angebot -> Abenteuer -> Gruppe ueber die Angebotsnummer
  const plaeneDir = path.join(dir, 'plaene'); fs.mkdirSync(plaeneDir);
  const plaene = [];
  for (const kind of ['lage', 'abenteuer']) {
    const nrn = [...new Set(calls.filter((c) => c.kind === kind).map((c) => c.nr))].sort((x, y) => x - y);
    for (const nr of nrn) {
      const aufn = calls.filter((c) => c.kind === kind && c.nr === nr), a0 = aufn[0], a1 = aufn[aufn.length - 1];
      const art = kind === 'lage' ? 'lage_grobplan' : 'abenteuer_bauplan';
      const endAus = kind === 'lage' ? ['angewandt', 'plan_wirkungslos', 'fehler', 'veraltet'] : ['gueltig', 'abgelehnt', 'ausfall'];
      const eintrag = logbuch.filter((e) => e.art === art && e.plan && e.plan.nr === nr && endAus.includes(e.ausgang)).pop() || null;
      const gelesen = a1.antwort ? (kind === 'lage' ? LagePrompt.planAusText(a1.antwort.text) : AP.bauplanAusText(a1.antwort.text)) : null;
      const angNr = eintrag && eintrag.plan && Number.isInteger(eintrag.plan.angebot) ? eintrag.plan.angebot : null;
      const ang = angNr != null ? angebote.get(angNr) : null;
      const gr = angNr != null ? gruppen.find((x) => x.angebot === angNr) : null;
      const mission = gr ? missionVon(gr) : null;
      const datei = `${kind}-${nn(nr)}.md`, promptDatei = `${kind}-${nn(nr)}.prompt.txt`;
      const rec = {
        art: kind, nr, datei: `plaene/${datei}`, prompt_datei: `plaene/${promptDatei}`, zeit: a0.start, spielzeit: a0.spielzeit, grenze: (eintrag && eintrag.plan && eintrag.plan.grenze) || a0.grenze || null, versuche: aufn.length, eskaliert: aufn.some((c) => c.eskaliert),
        dauer_s: eintrag && Number.isFinite(eintrag.dauer_s) ? eintrag.dauer_s : a1.wall_s, tokens: eintrag ? eintrag.tokens : (a1.antwort ? a1.antwort.tokens : 0),
        kosten_usd: modus === 'live' && a1.antwort && Number.isFinite(Number(a1.antwort.cost)) ? Number(a1.antwort.cost) : (modus === 'live' ? null : 0),
        ausgang: eintrag ? eintrag.ausgang : (a1.fehler ? 'fehler' : 'kein_logeintrag'), grund: (eintrag && eintrag.grund) || null, anbieter: (eintrag && eintrag.anbieter) || (a1.antwort && a1.antwort.anbieter) || (modus === 'live' ? 'claude' : 'mock'), modell: (eintrag && eintrag.modell) || (a1.antwort && a1.antwort.modell) || (modus === 'live' ? null : 'mock'),
        key: a1.antwort ? a1.antwort.key : null, aufnahme: modus === 'live' && a1.antwort && a1.antwort.key ? `regie/aufnahmen/${kind === 'lage' ? 'lage' : 'abenteuer'}/${a1.antwort.key}.json` : null,
        titel: gelesen && gelesen.plan ? gelesen.plan.titel || null : null, typen: gelesen && gelesen.plan && Array.isArray(gelesen.plan.beats) ? gelesen.plan.beats.map((b) => b && b.typ) : null,
        angebot: angNr, angenommen: !!(ang && ang.angenommen), gruppe: gr ? gr.id : null, mission: mission ? path.relative(dir, mission).split(path.sep).join('/') : null,
        zuordnung: kind === 'lage' ? 'Lage-Plan (kein Abenteuer)' : angNr == null ? (eintrag && eintrag.ausgang !== 'gueltig' ? 'kein Angebot (' + eintrag.ausgang + (eintrag.grund ? ': ' + eintrag.grund : '') + ')' : 'nicht eindeutig: kein gueltiger Logbuch-Eintrag') : !ang ? 'Angebot ' + angNr + ' nie im Brett gesehen' : !ang.angenommen ? 'Angebot a' + angNr + ' nicht angenommen' : !gr ? 'Angebot a' + angNr + ' angenommen, aber keine Gruppe im Mitschnitt (Mitschnitt ' + (mitOrdner ? 'ohne diese Gruppe' : 'nicht geschrieben') + ')' : 'eindeutig ueber Logbuch plan.nr ' + nr + ' > Angebot a' + angNr + ' > Gruppe ' + gr.id,
      };
      const prompt = typeof a0.prompt === 'string' ? a0.prompt : '(kein Prompt aufgenommen)\n';
      fs.writeFileSync(path.join(plaeneDir, promptDatei), ohneNamen(prompt), 'utf8');
      const fm = { abend_seed: o.seed, art: kind, aufruf: nr, grenze: rec.grenze, zeit: rec.zeit, spielzeit: rec.spielzeit, dauer_s: rec.dauer_s, tokens: rec.tokens, kosten_usd: rec.kosten_usd, gueltigkeit: rec.ausgang, grund: rec.grund, anbieter: rec.anbieter, modell: rec.modell, key: rec.key, versuche: rec.versuche, eskaliert: rec.eskaliert, aufnahme: rec.aufnahme, angebot: angNr, mission: rec.mission, zuordnung: rec.zuordnung };
      const L = [Ablage.frontmatter(fm), `# ${kind === 'lage' ? 'Lage-Plan' : 'Abenteuer-Plan'} ${nr} (Seed ${o.seed})`, '', `[Index des Laufs](../../index.md) · [Prompt](${promptDatei})${rec.aufnahme ? ` · [Aufnahme (Prompt und Rohantwort)](../${rec.aufnahme})` : ''}${mission ? ` · [Mission](../${rec.mission})` : ''}`, '', `**Zuordnung:** ${rec.zuordnung}`, ''];
      L.push('## Plan', '');
      if (kind === 'lage') { const p = gelesen && gelesen.plan; L.push(p ? `**Begründung:** ${p.begruendung != null ? p.begruendung : '–'}\n\n**Befehle:** ${JSON.stringify(p.befehle || [])}\n` : '_Kein lesbarer Plan._\n'); } else L.push(Ablage.planLesbar(gelesen));
      aufn.forEach((a, i) => { L.push(`## Rohantwort${aufn.length > 1 ? ' (Versuch ' + (i + 1) + ')' : ''}`, ''); if (a.antwort) L.push(Ablage.zaun(a.antwort.text, 'json')); else L.push(`_Keine Antwort: ${a.fehler || 'Fehler'}_`, ''); });
      if (eintrag) L.push('## Logbuch-Eintrag', '', Ablage.zaun(JSON.stringify(eintrag, null, 2), 'json'));
      fs.writeFileSync(path.join(plaeneDir, datei), ohneNamen(L.join('\n')), 'utf8');
      plaene.push(rec);
    }
  }
  // Abenteuer: Verknuepfung mit Gruppe und Mission, Beats vollstaendig (auch die, die der Bau ohne Zutun der Crew abgewickelt hat)
  for (const rec of abenteuerListe) {
    const a = angebote.get(rec.angebot);
    const gr = gruppen.find((x) => x.angebot === rec.angebot) || null;
    const m = gr ? missionVon(gr) : null;
    rec.gruppe = gr ? gr.id : null; rec.mission = m ? path.relative(dir, m).split(path.sep).join('/') : null; rec.mission_abs = m;
    const pl = plaene.find((p) => p.art === 'abenteuer' && p.angebot === rec.angebot);
    rec.plan = pl ? { datei: pl.datei, aufnahme: pl.aufnahme, nr: pl.nr } : null;
    rec.plan_quelle = pl ? (modus === 'live' ? 'Claude' : 'Mock-Spielleiter') : 'Rueckfall ohne Modell (Anschluss-Garantie)';
    const v = (a && a.ref && FD.vorlage(a.ref)) || null;
    rec.beats_vorlage = v ? v.beats.map((b, i) => {
      const bot = rec.beats.find((x) => x.id === b.id);
      if (bot) return Object.assign({ nr: i + 1 }, bot);
      const gd = (rec.gedaechtnis || []).filter((e) => String(e).startsWith(b.typ + '_'));
      return { nr: i + 1, typ: b.typ, id: b.id, wie: gd.length ? 'ohne Zutun der Crew (Baustein)' : 'nicht erreicht', ausgang: gd.find((e) => /_gelungen$/.test(e)) ? 'gelungen' : gd.find((e) => /_gescheitert$/.test(e)) ? 'gescheitert' : (gd[0] || '–'), kuenstlich: {}, notiz: null };
    }) : [];
  }
  const erreichtIdx = (r) => { let last = -1; r.beats_vorlage.forEach((b, i) => { if (b.wie !== 'nicht erreicht') last = i; }); return last; };
  const ergebnis = {
    seed: o.seed, modus, welt_dir: wDir, dauer_s, spruenge: w.stat.spruenge, grenzen, abbruch, server_fehler: g.errors, protokoll_zeilen: protokoll.length, kuenstlich: kz,
    budget: { limit: budget1.limit, vorher: budget0.used, nachher: budget1.used, delta: budget1.used - budget0.used, calls: budget1.calls },
    kosten_usd: modus === 'live' ? (calls.every((c) => c.antwort && Number.isFinite(Number(c.antwort.cost))) ? calls.reduce((s, c) => s + Number(c.antwort.cost), 0) : (calls.some((c) => c.antwort && Number.isFinite(Number(c.antwort.cost))) ? calls.reduce((s, c) => s + (c.antwort && Number.isFinite(Number(c.antwort.cost)) ? Number(c.antwort.cost) : 0), 0) : null)) : 0,
    anfragen: { lage: calls.filter((c) => c.kind === 'lage').length, abenteuer: calls.filter((c) => c.kind === 'abenteuer').length, andere: calls.filter((c) => c.kind !== 'lage' && c.kind !== 'abenteuer').length, mit_fehler: calls.filter((c) => c.fehler).length },
    kontingent: kont.erreicht ? Object.assign({}, kont, { funk: kont.funk ? { von: kont.funk.von, text: kont.funk.text } : null, wall_s_ab_start: (kont.wall - t0) / 1000 }) : { erreicht: false, limit: budget1.limit, used: budget1.used, freigabe: null },
    angebote: [...angebote.values()].map((a) => {
      const pl = plaene.find((p) => p.art === 'abenteuer' && p.angebot === a.nr);
      return Object.assign({}, a, { plan_quelle: pl ? (modus === 'live' ? 'Claude' : 'Mock-Spielleiter') : 'Rueckfall (kein Plan-Aufruf)', plan: pl ? pl.datei : null, aufnahme: pl ? pl.aufnahme : null, abenteuer: abenteuerListe.some((x) => x.angebot === a.nr), ausgang: a.angenommen ? (abenteuerListe.some((x) => x.angebot === a.nr) ? 'angenommen und gespielt' : 'angenommen') : (brett(cl[0]).some((x) => x.id === a.id) ? 'am Ende noch offen' : 'verfallen oder abgeloest ohne Annahme') });
    }),
    abenteuer: abenteuerListe.map((r) => Object.assign({}, r, { gespielt_bis: erreichtIdx(r) >= 0 ? r.beats_vorlage[erreichtIdx(r)].typ : null })),
    notrufe: [...notrufe.values()].map((n) => Object.assign({}, n, { reaktion_spielzeit_s: n.beantwortet ? n.beantwortet.spielzeit - n.erschienen.spielzeit : null, reaktion_s: n.beantwortet ? (n.beantwortet.wall - n.erschienen.wall) / 1000 : null })),
    bitten: ereignisse.bitten, plaene,
    mitschnitt: mitOrdner ? { ordner: mitOrdner, index: path.join(mitOrdner, 'index.md'), gruppen: gruppen.length } : null,
    logbuch_eintraege: logbuch.length,
  };
  fs.writeFileSync(path.join(dir, 'protokoll.txt'), ohneNamen(protokoll.join('\n')) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'ergebnis.json'), ohneNamen(JSON.stringify(ergebnis, null, 1)), 'utf8');
  zeile(`fertig: ${ergebnis.abenteuer.length} Abenteuer, ${ergebnis.angebote.length} Angebote, ${plaene.length} Plaene, Tokens ${ergebnis.budget.delta}, Serverfehler ${g.errors}`);
  return { ergebnis, g };
}

// =====================================================================================================================================================
// Aufrufer: Pruefungen, Lauf-Ordner, ein Kindprozess je Seed, index.md und messung.json
// =====================================================================================================================================================
const relLink = (von, nach) => path.relative(von, nach).split(path.sep).map(encodeURIComponent).join('/');
const sek = (x) => (Number.isFinite(x) ? f(x, 10) + ' s' : '–');

function indexSchreiben(lauf, o, modus, ergebnisse, hinweise) {
  const L = [];
  const gesamt = { abende: ergebnisse.length, abenteuer: 0, angebote: 0, angenommen: 0, tokens: 0, kosten: 0, kostenBekannt: true };
  for (const E of ergebnisse) { if (!E.ergebnis) continue; const e = E.ergebnis; gesamt.abenteuer += e.abenteuer.length; gesamt.angebote += e.angebote.length; gesamt.angenommen += e.angebote.filter((a) => a.angenommen).length; gesamt.tokens += e.budget.delta; if (e.kosten_usd == null) gesamt.kostenBekannt = false; else gesamt.kosten += e.kosten_usd; }
  L.push(Ablage.frontmatter({ werkzeug: 'live-abend', modus, erzeugt: new Date().toISOString(), seeds: o.seeds, abende: ergebnisse.length, abenteuer_gespielt: gesamt.abenteuer, tokens: gesamt.tokens, kosten_usd: gesamt.kostenBekannt ? gesamt.kosten : null }));
  L.push(`# Live-Abend (${modus === 'live' ? 'echter Claude' : 'Mock-Spielleiter'}) – ${ergebnisse.length} Abend${ergebnisse.length === 1 ? '' : 'e'}`, '');
  L.push(`Bot-Crew: drei Spieler (Spieler 1 bis 3), Freie Fahrt Sund mit echten Sprüngen, Mitschnitt an. Je Abend ein eigener Prozess mit eigenem Token-Zähler${modus === 'live' ? ' (CLAUDE_TOKEN_BUDGET gilt je Abend)' : ''}. Aufruf: \`${ohneNamen(hinweise.aufruf)}\``, '');
  L.push('| Seed | Dauer | Sprünge | Tokens | Kosten | Angebote | angenommen | gespielt | Notrufe (Reise) | Bitten | Kontingent | Serverfehler |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const E of ergebnisse) {
    if (!E.ergebnis) { L.push(`| ${E.seed} | – | – | – | – | – | – | – | – | – | **kein Ergebnis** (${E.grund}) | – |`); continue; }
    const e = E.ergebnis;
    L.push(`| ${e.seed} | ${sek(e.dauer_s)} | ${e.spruenge} | ${f(e.budget.delta)} | ${e.kosten_usd == null ? 'unbekannt' : f(e.kosten_usd, 10000) + ' $'} | ${e.angebote.length} | ${e.angebote.filter((a) => a.angenommen).length} | ${e.abenteuer.length} | ${e.notrufe.length} | ${e.bitten.length} | ${e.kontingent.erreicht ? 'erreicht' : 'nein'} | ${e.server_fehler} |`);
  }
  L.push('', `Summe: ${gesamt.abenteuer} Abenteuer gespielt, ${gesamt.angenommen} von ${gesamt.angebote} Angeboten angenommen, ${f(gesamt.tokens)} Tokens${gesamt.kostenBekannt ? ', ' + f(gesamt.kosten, 10000) + ' $' : ' (Kosten nicht vollständig bekannt)'}.`, '');
  for (const E of ergebnisse) {
    const abDir = path.join(lauf, 'abend-' + E.seed);
    L.push(`## Abend Seed ${E.seed}`, '');
    if (!E.ergebnis) { L.push(`**Kein Ergebnis:** ${E.grund}. Protokoll und Logbuch, soweit geschrieben: [abend-${E.seed}/](abend-${E.seed}/)`, ''); continue; }
    const e = E.ergebnis;
    L.push(`- Dauer ${sek(e.dauer_s)}, ${e.spruenge} gelungene Sprünge, ${e.grenzen} Tätigkeitsgrenzen (künstlich gesetzt), Serverfehler ${e.server_fehler}${e.abbruch ? ', **Abbruch: ' + e.abbruch + '**' : ''}`);
    L.push(`- Anfragen an den Spielleiter: ${e.anfragen.lage} Lage, ${e.anfragen.abenteuer} Abenteuer-Komposition${e.anfragen.mit_fehler ? ', davon ' + e.anfragen.mit_fehler + ' mit Fehler' : ''}; Tokens ${f(e.budget.delta)} (Limit ${f(e.budget.limit)}), Kosten ${e.kosten_usd == null ? 'unbekannt' : f(e.kosten_usd, 10000) + ' $'}`);
    L.push(`- Protokoll: [protokoll.txt](abend-${E.seed}/protokoll.txt) · Logbuch und Aufnahmen: [regie/](abend-${E.seed}/regie/) · Rohdaten: [ergebnis.json](abend-${E.seed}/ergebnis.json)${e.mitschnitt ? ' · Mitschnitt: [index.md](' + relLink(lauf, e.mitschnitt.index) + ')' : ' · Mitschnitt: nicht geschrieben'}`);
    L.push(`- Künstlich gesetzte Schritte insgesamt: ${Object.keys(e.kuenstlich).length ? Object.entries(e.kuenstlich).map(([a, n]) => a + ' ×' + n).join(', ') : 'keine'}`, '');
    // Kontingent
    L.push('### Kontingent', '');
    if (e.kontingent.erreicht) {
      const kk = e.kontingent;
      L.push(`- **Kontingent erreicht** nach ${sek(kk.wall_s_ab_start)} (Spielzeit ${f(kk.spielzeit, 10)} s): ${f(kk.used)} von ${f(kk.limit)} Tokens, Schwelle ${f(kk.schwelle)}. Der Abend lief im Rückfall weiter (${e.abenteuer.length} Abenteuer, Serverfehler ${e.server_fehler}).`);
      L.push(`- Funkmeldung: ${kk.funk ? '„' + ohneNamen(kk.funk.von + ': ' + kk.funk.text) + '“' : '**keine Funkmeldung gesehen**'}`);
      L.push(`- Freigabe (--freigeben): ${kk.freigabe ? (kk.freigabe.antwort ? (kk.freigabe.antwort.ok ? 'gesendet, ok nach ' + sek(kk.freigabe.nach_s) + ', Limit danach ' + f(kk.freigabe.limit_danach) : 'gesendet, abgelehnt: ' + (kk.freigabe.antwort.code || '?')) : 'gesendet, keine Antwort') : 'nicht gesendet'}`, '');
    } else L.push(`- Nicht erreicht (${f(e.kontingent.used)} von ${f(e.kontingent.limit)} Tokens).`, '');
    // Angebote
    L.push('### Angebote und Reaktionszeiten', '', '| Angebot | Titel | Beats | Plan | Sichtbar (Spielzeit) | Annahme nach | Ausgang |', '|---|---|---|---|---|---|---|');
    for (const a of e.angebote) {
      const plan = a.plan ? `[${a.plan_quelle}](${relLink(lauf, path.join(abDir, a.plan))})` + (a.aufnahme ? ` · [Aufnahme](${relLink(lauf, path.join(abDir, a.aufnahme))})` : '') : a.plan_quelle;
      L.push(`| ${a.id} | ${Ablage.zelle(ohneNamen(a.titel || '–'))} | ${a.typen.join(' > ')} | ${plan} | ${f(a.sichtbar.spielzeit, 10)} s | ${a.angenommen ? f(a.angenommen.reaktion_s, 10) + ' s (Spielzeit ' + f(a.angenommen.reaktion_spielzeit_s, 10) + ' s)' : '–'} | ${a.ausgang} |`);
    }
    if (!e.angebote.length) L.push('| – | keine Angebote im Brett | | | | | |');
    L.push('', 'Die Reaktionszeit ist die des Bots (er nimmt an, sobald er das Angebot sieht), kein Maß für Spieler.', '');
    // Abenteuer
    L.push('### Gespielte Abenteuer', '');
    if (!e.abenteuer.length) L.push('_Kein Abenteuer gespielt._', '');
    for (const A of e.abenteuer) {
      const mission = A.mission ? `[mission.md](${relLink(lauf, path.join(abDir, A.mission))})` : '**keine mission.md zugeordnet**';
      L.push(`#### ${Ablage.zelle(ohneNamen(A.titel || A.faden))} (Angebot a${A.angebot}, Faden ${A.faden})`, '');
      L.push(`- Ausgang: **${A.ausgang}** nach ${sek(A.dauer_s)}, erreicht bis Beat ${A.gespielt_bis || '–'}; NSC ${A.nsc_status || '–'}`);
      L.push(`- Mission: ${mission} · Plan: ${A.plan ? `[${A.plan_quelle}](${relLink(lauf, path.join(abDir, A.plan.datei))})${A.plan.aufnahme ? ' · [Aufnahme](' + relLink(lauf, path.join(abDir, A.plan.aufnahme)) + ')' : ''}` : A.plan_quelle}`);
      L.push(`- Künstlich gesetzte Schritte: ${Object.keys(A.kuenstlich).length ? Object.entries(A.kuenstlich).map(([a, n]) => a + ' ×' + n).join(', ') : 'keine'}${A.nachhilfe.length ? '; Beat vom Bot gestartet statt vom Spielleiter: ' + A.nachhilfe.map((x) => x.beat + (x.ok ? '' : ' (abgelehnt)')).join(', ') : ''}`, '');
      L.push('| Beat | Typ | Wie gespielt | Ausgang | Künstlich | Notiz |', '|---|---|---|---|---|---|');
      for (const b of A.beats_vorlage) L.push(`| ${b.nr} | ${b.typ} | ${b.wie} | ${b.ausgang} | ${Object.keys(b.kuenstlich || {}).filter((x) => x !== 'spieler-setzen').join(', ') || '–'} | ${Ablage.zelle(b.notiz || '')} |`);
      L.push('');
    }
    // Plan -> Mission
    L.push('### Zuordnung Plan → Mission', '', '| Plan | Art | Ausgang | Tokens | Kosten | Zuordnung | Mission |', '|---|---|---|---|---|---|---|');
    for (const p of e.plaene) {
      L.push(`| [${p.art}-${nn(p.nr)}](${relLink(lauf, path.join(abDir, p.datei))})${p.aufnahme ? ' · [Aufnahme](' + relLink(lauf, path.join(abDir, p.aufnahme)) + ')' : ''} | ${p.art} | ${p.ausgang}${p.grund ? ' (' + Ablage.zelle(p.grund) + ')' : ''} | ${f(p.tokens || 0)} | ${p.kosten_usd == null ? '–' : f(p.kosten_usd, 10000) + ' $'} | ${Ablage.zelle(p.zuordnung)} | ${p.mission ? '[mission.md](' + relLink(lauf, path.join(abDir, p.mission)) + ')' : '–'} |`);
    }
    if (!e.plaene.length) L.push('| – | keine Anfrage an den Spielleiter | | | | | |');
    L.push('');
    // Notrufe
    L.push('### Notrufe der Reise', '');
    if (!e.notrufe.length) L.push('_Keine Notrufe in diesem Abend._', '');
    else { L.push('| Nr | Art | Sektor | Ausgang | Reaktion (Spielzeit) |', '|---|---|---|---|---|'); for (const n of e.notrufe) L.push(`| ${n.nr} | ${n.id} | ${n.hex} | ${n.ausgang} | ${n.reaktion_spielzeit_s != null ? f(n.reaktion_spielzeit_s, 10) + ' s' : '–'} |`); L.push(''); }
  }
  // Was der Bot nicht spielen kann
  L.push('## Was der Bot nicht spielen kann', '', 'Der Bot hat keine Bordkanone, keinen Anflug an Stationen und kein Gespür für Gefechte. Beats mit Szene spielt er mit dem Testhelfer (Gegner zerstören, im Verlauf als `testhelfer-kill` ausgewiesen) oder, mit `--ohne-testhelfer`, gar nicht (die Frist beendet den Beat als gescheitert). `spontanhilfe` wartet auf ein Gefecht, das der Bot nicht auslöst. Orte werden wo möglich über echte Sprünge angeflogen, sonst gesetzt (`teleport`); das Andocken bei `fracht` und jede Tätigkeitsgrenze werden gesetzt. Startet der Spielleiter einen fälligen Beat nicht, startet ihn der Bot nach `--geduld` selbst (`faden-weiter-bot`). Alles steht je Abenteuer und Beat in den Tabellen oben, nichts wird still übersprungen.', '');
  const text = ohneNamen(L.join('\n'));
  Ablage.schreibe(lauf, 'index.md', text);
  return text;
}

async function hauptprogramm() {
  const o = aufrufLesen();
  if (o.intern) {   // Kindprozess: ein Abend
    let res = null;
    try { res = await abend(o); } catch (e) { console.log('FEHLER: ' + (e && e.stack)); try { fs.writeFileSync(path.join(o.abendDir, 'fehler.txt'), String(e && e.stack || e)); } catch (e2) { /* egal */ } process.exit(1); }
    process.exit(res.ergebnis.server_fehler > 0 || res.ergebnis.abbruch ? 1 : 0);
  }
  const live = o.live || (!o.mock && String(process.env.SPIELLEITER_LLM || '').toLowerCase() === 'live');
  const modus = live ? 'live' : 'mock';
  if (live) {
    if (process.env.LLM_LIVE !== '1') { console.log('Live-Abend: nicht gemessen (LLM_LIVE=1 ist nicht gesetzt; echte Aufrufe kosten Geld und laufen nur von Hand).'); return; }
    const cli = require('../server/mission/llm.js').claudeFinden();
    if (!cli.cmd) { console.log(`Live-Abend: nicht gemessen (Claude-CLI nicht gefunden; versucht: ${cli.versucht.join(', ') || 'nichts'}; CLAUDE_CLI setzen).`); return; }
    console.log(`Claude-CLI: ${cli.quelle}; Token-Deckel je Abend ${require('../server/mission/llm.js').budget().limit} (CLAUDE_TOKEN_BUDGET), ${o.seeds.length} Abend(e), je höchstens ${o.dauer} s`);
  }
  let lauf;
  try { lauf = Ablage.laufOrdner(o.wurzel, 'abend-' + modus); } catch (e) { console.error(e.message); process.exit(2); }
  console.log(`Ablage: ${lauf}`);
  const ergebnisse = [];
  for (const seed of o.seeds) {
    const abDir = path.join(lauf, 'abend-' + seed);
    const kind = ['--intern', '--seed', String(seed), '--abend-dir', abDir, '--dauer', String(o.dauer), '--abenteuer', String(o.abenteuer), '--abenteuer-dauer', String(o.abenteuerDauer), '--geduld', String(o.geduld), '--grenzabstand', String(o.grenzabstand), live ? '--live' : '--mock'];
    if (o.sprunglimit) kind.push('--sprunglimit', String(o.sprunglimit));
    if (o.plaene) kind.push('--plaene', String(o.plaene));
    if (o.freigeben) kind.push('--freigeben');
    kind.push('--rueckfall-nach', String(o.rueckfallNach));
    if (!o.testhelfer) kind.push('--ohne-testhelfer');
    if (!o.nachhilfe) kind.push('--ohne-nachhilfe');
    if (o.mitschnittDir) kind.push('--mitschnitt-dir', o.mitschnittDir);
    const hart = (o.dauer + o.abenteuerDauer + 400) * 1000;   // harte Grenze: ein haengender Abend bricht den Lauf nicht
    const code = await new Promise((resolve) => {
      const p = cp.spawn(process.execPath, [__filename, ...kind], { cwd: path.join(__dirname, '..'), env: process.env, stdio: 'inherit' });
      const t = setTimeout(() => { try { p.kill(); } catch (e) { /* egal */ } }, hart);
      p.on('exit', (c, sig) => { clearTimeout(t); resolve(c == null ? 'Signal ' + sig : c); });
      p.on('error', () => { clearTimeout(t); resolve('Start fehlgeschlagen'); });
    });
    const ef = path.join(abDir, 'ergebnis.json');
    let ergebnis = null, grund = null;
    if (fs.existsSync(ef)) { try { ergebnis = JSON.parse(fs.readFileSync(ef, 'utf8')); } catch (e) { grund = 'ergebnis.json unlesbar'; } } else grund = `Abend endete ohne Ergebnis (Exit ${code})`;
    ergebnisse.push({ seed, code, ergebnis, grund });
  }
  const aufruf = 'node tools/live-abend.js ' + process.argv.slice(2).join(' ');
  indexSchreiben(lauf, o, modus, ergebnisse, { aufruf });
  Ablage.schreibe(lauf, 'messung.json', ohneNamen(JSON.stringify({ werkzeug: 'live-abend', modus, aufruf, erzeugt: new Date().toISOString(), optionen: { seeds: o.seeds, dauer: o.dauer, sprunglimit: o.sprunglimit, abenteuer: o.abenteuer, abenteuerDauer: o.abenteuerDauer, plaene: o.plaene, freigeben: o.freigeben, testhelfer: o.testhelfer, nachhilfe: o.nachhilfe, geduld: o.geduld, grenzabstand: o.grenzabstand, rueckfallNach: o.rueckfallNach }, abende: ergebnisse.map((E) => ({ seed: E.seed, exit: E.code, grund: E.grund, ergebnis: E.ergebnis })), namensfilter_ersetzungen: ersetzt }, null, 1)));
  console.log(`Index: ${path.join(lauf, 'index.md')}`);
  for (const E of ergebnisse) {
    if (!E.ergebnis) { console.log(`Abend ${E.seed}: KEIN ERGEBNIS (${E.grund})`); continue; }
    const e = E.ergebnis;
    console.log(`Abend ${E.seed}: ${f(e.dauer_s, 10)} s, ${e.spruenge} Sprünge, ${e.angebote.length} Angebote, ${e.angebote.filter((a) => a.angenommen).length} angenommen, ${e.abenteuer.length} gespielt, Tokens ${e.budget.delta}, Kontingent ${e.kontingent.erreicht ? 'erreicht' : 'nein'}, Serverfehler ${e.server_fehler}${e.abbruch ? ', ABBRUCH ' + e.abbruch : ''}`);
  }
  process.exit(ergebnisse.some((E) => !E.ergebnis || E.ergebnis.server_fehler > 0 || E.ergebnis.abbruch) ? 1 : 0);
}

if (require.main === module) hauptprogramm().catch((e) => { console.error(e && e.stack); process.exit(1); });
module.exports = { ohneNamen };
