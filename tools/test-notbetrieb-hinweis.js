'use strict';
// FRE-01 C: Hinweis "Spielleiter arbeitet im Notbetrieb" (LageSpielleiter.notbetriebMelden, Daten content/welt/notbetrieb-hinweis.json: notbetrieb_funk, notbetrieb_gruende). Faellt das Modell im
// Live-Betrieb der Freien Fahrt aus, merkt die Crew es EINMAL je Sitzung (Funk lage:1 + Zeile im Server-Log mit Grund); nichts blockiert, der Rueckfall (content/faeden/anschluss.json) liefert weiter.
// Ohne Netz und ohne echten Aufruf: Transport-Stubs, Spion auf jeden Kindprozess, kein LLM_LIVE in process.env. Die Erwartungen stehen hier selbst.
// Geprueft: (a) live + CLI fehlt: Hinweis genau einmal ueber viele Ausfaelle und Spruenge, Brett liefert, 0 Fehler · (b) je Ausfallgrund · Einzelfehler melden nicht · (c) Rueckfall-Betrieb: kein Hinweis ·
// (d) Betrieb aus: kein Hinweis · (e) zweite Sitzung meldet wieder einmal, Flag nicht im Weltstand/Snapshot · (f) Funktext aus den Daten · (g) Rueckfall liefert weiter das Angebot.
// Aufruf: node tools/test-notbetrieb-hinweis.js [begriff ...]        (npm run test:notbetrieb-hinweis)
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));

const prozesse = [];
for (const k of ['spawn', 'spawnSync', 'exec', 'execFile', 'execSync', 'execFileSync', 'fork']) {
  cp[k] = function (...a) { prozesse.push(k + ' ' + String(a[0])); throw new Error('Test: Kindprozess verboten (' + k + ')'); };
}
delete process.env.LLM_LIVE;
const ENV_VOR = JSON.stringify(Object.assign({}, process.env));

const { Game } = require('../server/game.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Faden = require('../server/sim/faden.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const DATEN = require('../content/welt/notbetrieb-hinweis.json').werte;
const T = DATEN.notbetrieb_funk.wert;
const GRUENDE = DATEN.notbetrieb_gruende.wert;

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fre01c-'));
let seq = 0;
const frisch = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const tot = path.join(TMP, 'es-gibt-keine-cli');   // toter Pfad
const ENV_OHNE_CLI = { CLAUDE_CLI: tot, APPDATA: path.join(TMP, 'leer'), USERPROFILE: path.join(TMP, 'leer'), HOME: path.join(TMP, 'leer'), PATH: path.join(TMP, 'leer') };
const ENV_MIT_CLI = { CLAUDE_CLI: process.execPath };   // Datei existiert (wird nie gestartet: der Transport ist ein Stub)

function bauGame(o) {
  o = o || {};
  const dir = o.dir || frisch();
  const env = Object.assign({ MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'regie') }, o.env || {});
  const g = new Game({ szenarioSchalter: o.szenarioSchalter !== false, noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env, log: () => {} });
  g.fehler = []; g.logs = [];
  g.logFn = (...a) => g.logs.push(a.join(' '));
  const ce = g.countError.bind(g); g.countError = (w, e) => { g.fehler.push(w + ': ' + (e && e.message)); return ce(w, e); };
  g.funk = [];
  const rad = g.emit.bind(g); g.emit = function (k, d) { if (k === 'radio') g.funk.push(d); return rad(k, d); };
  const conn = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(conn);
  g.handleMessage(conn, { t: 'hello', clientId: 'FF0', name: 'Bot', color: 0 });
  g.conn = conn; g.dir = dir;
  return g;
}
const hinweise = (g) => g.funk.filter((f) => f.text === T.text);
const logZeilen = (g) => g.logs.filter((z) => z.includes('Notbetrieb'));
function startLive(env, stub) {
  const g = bauGame({ env });
  g.lobbyOpts.liveSpielleiter = true;
  g.handleMessage(g.conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  g.step();   // legt den Lage-Spielleiter an; erstes update: Start-Pruefung der CLI
  if (stub) { const l = g.lageSpielleiter; l.opts.transport = stub; l.llm = null; }
  return g;
}
const stubFehler = (code, msg) => ({ name: 'stub', call: async () => { const e = new Error(msg || code); e.code = code; throw e; } });
const stubText = (text) => ({ name: 'stub', call: async () => ({ text, usage: { input: 1, output: 1 } }) });
const pause = () => new Promise((r) => setImmediate(r));
async function laufen(g, schritte) { for (let i = 0; i < schritte; i++) { await pause(); g.step(); } }
// ein Lage-Plan und ein Abenteuer-Aufruf, beide ueber die Debug-Wege (ohne Mindestabstand/Deckel), danach abholen
async function aufrufe(g) {
  const l = g.lageSpielleiter;
  l.letzterStartTick = null; l.aufrufe = 0; l.abenteuer.aufrufe = 0;
  l.planErzwingen();
  await laufen(g, 3);
  const F = g.weltsim.faeden; if (F && F.abenteuerAngebote) F.abenteuerAngebote.length = 0;   // Platz fuer einen Abenteuer-Aufruf
  l.abenteuer.erzwingen();
  await laufen(g, 3);
}
function springe(g, anzahl) {
  let getan = 0;
  const platz = (x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
  for (; getan < anzahl; getan++) {
    const von = Sektoren.hexVonOrt(g.ship.scene);
    const kand = Sektoren.nachbarn(von).filter((h) => Sektoren.spielbar(h) && Sektoren.ortVonHex(h) && !Sektoren.istLeerraum(h));
    let gut = false;
    for (const h of kand) {
      g.explore.markBoje(Sektoren.kanteId(von, h));
      if (Sprung.hexGrund(g, von, h)) continue;
      if (Sprung.selectDest(g, Sektoren.ortVonHex(h))) continue;
      const p = Sprung.sprungpunkt(g, h); if (!p) continue;
      platz(p.x - 80, p.y);
      for (let k = 0; k < 900 && !g.ship.jump.ready; k++) { g.space.enemies = []; g.step(); }
      g.space.enemies = [];
      if (!Sprung.doJump(g)) { gut = true; break; }
    }
    if (!gut) break;
    for (let k = 0; k < 40; k++) g.step();
  }
  return getan;
}
const angebote = (g) => (g.weltsim && g.weltsim.faeden ? g.weltsim.faeden.abenteuerAngebote.length : 0);

section('Daten', () => {
  ok(typeof T.text === 'string' && /Notbetrieb/.test(T.text) && typeof T.sprecher === 'string' && T.sprecher.length > 0, 'notbetrieb_funk: Text mit Notbetrieb und Sprecher');
  ok(typeof DATEN.notbetrieb_funk._hinweis === 'string' && DATEN.notbetrieb_funk.einheit && DATEN.notbetrieb_gruende._hinweis && DATEN.notbetrieb_gruende.einheit, 'Format der Nachbarwerte: einheit und _hinweis');
  ok(Array.isArray(GRUENDE) && ['cli_fehlt', 'ENOENT', 'RATE_LIMIT', 'ETIMEDOUT', 'REFUSED', 'BUDGET', 'OFFLINE', 'EMPTY'].every((g) => GRUENDE.includes(g)) && !GRUENDE.includes('lokal') && !GRUENDE.includes('ANTWORT_UNLESBAR'), 'Gruende-Liste: Modell-Ausfaelle ja, Einzelfehler (lokal, Pruefer-Ablehnung) nein');
  ok(!/\bBot\b/.test(T.text) && !/\{/.test(T.text), 'kein Spielername, keine Platzhalter im Funktext');
});

section('(a) live + CLI fehlt: Hinweis genau einmal, nichts blockiert', async () => {
  const g = startLive(ENV_OHNE_CLI);
  const l = g.lageSpielleiter;
  ok(l && l.mode === 'live' && !l.rueckfallBetrieb, 'Lage-Spielleiter im Betrieb live');
  ok(hinweise(g).length === 1 && hinweise(g)[0].lage === 1 && hinweise(g)[0].from === T.sprecher, 'sofort beim Start: ein Funkhinweis (lage:1, Sprecher aus den Daten), noch vor dem ersten Plan');
  ok(logZeilen(g).length === 1 && /cli_fehlt/.test(logZeilen(g)[0]), 'Server-Log: eine Zeile mit Grund cli_fehlt (' + (logZeilen(g)[0] || '').slice(0, 90) + ')');
  ok(l.aufrufe === 0 && !l.job, 'kein Aufruf noetig fuer den Hinweis');
  l.opts.transport = stubFehler('ENOENT', 'claude nicht gefunden'); l.llm = null;
  await aufrufe(g); await aufrufe(g); await aufrufe(g);
  ok(l.zaehler.fehler >= 1 || l.aus, 'Plaene scheitern (Zaehler ' + l.zaehler.fehler + ', aus: ' + l.aus + ')');
  ok(springe(g, 5) === 5, '5 echte Spruenge (Grenzen laufen)');
  g.lageGrenze('andocken'); g.lageGrenze('szene_ende'); await laufen(g, 4);
  ok(hinweise(g).length === 1 && logZeilen(g).length === 1, 'nach mehreren Ausfaellen und Spruengen weiter genau EIN Hinweis und EINE Logzeile (' + hinweise(g).length + '/' + logZeilen(g).length + ')');
  ok(angebote(g) >= 1 || (Brett.snapshot(g) || { angebote: [] }).angebote.length >= 1, 'Brett liefert ein Angebot aus dem Rueckfall (' + angebote(g) + ')');
  const bs = Brett.snapshot(g);
  ok(bs && bs.ok === 1 && bs.angebote.length >= 1, 'Brett-Snapshot ok:1 mit Angebot');
  ok(g.fehler.length === 0 && g.errors === 0, 'keine Serverfehler ' + g.fehler.join('|'));
  ok(prozesse.length === 0 && process.env.LLM_LIVE === undefined, 'kein CLI-Prozess, process.env.LLM_LIVE ungesetzt');
  g.zurLobby();
});

section('(b) je Ausfallgrund genau ein Hinweis; Einzelfehler melden nicht', async () => {
  for (const [code, msg] of [['RATE_LIMIT', 'claude: 429 Too Many Requests'], ['ETIMEDOUT', 'Zeitueberschreitung'], ['REFUSED', 'Live-Aufruf verweigert'], ['ENOENT', 'claude nicht startbar'], ['EXIT', 'claude fehlgeschlagen (1)'], ['OFFLINE', 'Ollama nicht erreichbar'], ['EMPTY', 'Ollama: leere Antwort']]) {
    const g = startLive(ENV_MIT_CLI, stubFehler(code, msg));
    ok(hinweise(g).length === 0, code + ': vor dem Ausfall kein Hinweis (CLI da)');
    await aufrufe(g); await aufrufe(g);
    ok(hinweise(g).length === 1 && logZeilen(g).length === 1 && logZeilen(g)[0].includes(code), code + ': genau ein Hinweis, Logzeile mit Grund');
    ok(g.fehler.length === 0, code + ': keine Serverfehler ' + g.fehler.join('|'));
    g.zurLobby();
  }
  // Frist: Antwort bleibt aus, die Spielzeit laeuft ueber timeout_s
  const gt = startLive(ENV_MIT_CLI, { name: 'stub', call: () => new Promise(() => {}) });
  const lt = gt.lageSpielleiter; lt.planErzwingen(); await laufen(gt, 2);
  ok(lt.zustand === 'laeuft', 'Frist: Anfrage in der Luft');
  gt.time += lt.W.timeout_s + 5; await laufen(gt, 2);
  ok(hinweise(gt).length === 1 && /ETIMEDOUT/.test(logZeilen(gt)[0] || ''), 'Frist (Timeout): ein Hinweis, Grund ETIMEDOUT');
  gt.zurLobby();
  // Budget: Token-Deckel leer (min_budget), Plan und Abenteuer-Komposition
  LLM.setBudgetLimit(10);
  try {
    const gb = startLive(ENV_MIT_CLI, stubText('{"befehle":[]}'));
    const lb = gb.lageSpielleiter; lb.letzterStartTick = null; const r = lb.planErzwingen();
    ok(r.grund === 'budget' && hinweise(gb).length === 1 && /BUDGET/.test(logZeilen(gb)[0] || ''), 'BUDGET (Lage-Gate): ein Hinweis, Grund BUDGET (' + r.grund + ')');
    lb.planErzwingen(); lb.planErzwingen();
    ok(hinweise(gb).length === 1, 'BUDGET: weitere Grenzen melden nicht erneut');
    gb.zurLobby();
    const ga = startLive(ENV_MIT_CLI, stubText('{"befehle":[]}'));
    const la = ga.lageSpielleiter; const F = ga.weltsim.faeden; if (F && F.abenteuerAngebote) F.abenteuerAngebote.length = 0;
    la.abenteuer.erzwingen();
    ok(hinweise(ga).length === 1 && /BUDGET/.test(logZeilen(ga)[0] || ''), 'BUDGET (Abenteuer-Gate): ein Hinweis');
    ga.zurLobby();
  } finally { LLM.resetBudget(); }
  // Einzelfehler: unbrauchbare Antwort, ungueltiger Plan, Pruefer-Ablehnung: Hinweis bleibt aus
  for (const [name, text] of [['unbrauchbare Antwort (kein JSON)', 'das ist kein Plan'], ['leere Antwort', ''], ['ungueltiger Plan', '{"befehle":[{"typ":"gibt_es_nicht"}]}']]) {
    const g = startLive(ENV_MIT_CLI, stubText(text));
    await aufrufe(g); await aufrufe(g);
    ok(g.lageSpielleiter.zaehler.fehler >= 1 || g.lageSpielleiter.abenteuer.zaehler.ausfall + Object.keys(g.lageSpielleiter.abenteuer.zaehler.abgelehnt).length >= 1, name + ': als Fehler im Logbuch gezaehlt');
    ok(hinweise(g).length === 0 && logZeilen(g).length === 0, name + ': Einzelfehler meldet nicht Notbetrieb');
    ok(g.fehler.length === 0, name + ': keine Serverfehler');
    g.zurLobby();
  }
  const g2 = startLive(ENV_MIT_CLI, stubText('x'));
  const l2 = g2.lageSpielleiter;
  ok(l2.notbetriebMelden('lokal') === false && l2.notbetriebMelden('ABENTEUER_DOPPELT') === false && l2.notbetriebMelden('ANTWORT_UNLESBAR') === false && hinweise(g2).length === 0, 'Codes ausserhalb der Liste (lokal, Pruefer-Ablehnungen) melden nie');
  ok(GRUENDE.every((x) => x !== 'lokal'), 'Liste enthaelt nur Modell-Ausfaelle');
  g2.zurLobby();
});

section('(c) Rueckfall-Betrieb (absichtlich ohne Modell): kein Hinweis', async () => {
  const g = bauGame({ env: ENV_OHNE_CLI });
  g.handleMessage(g.conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  const l = g.lageSpielleiter;
  ok(l && l.rueckfallBetrieb && l.mode === 'off', 'Rueckfall-Betrieb (mode off)');
  springe(g, 6);
  g.lageGrenze('andocken'); l.planErzwingen(); l.abenteuer.erzwingen(); await laufen(g, 3);
  for (const grund of GRUENDE) l.notbetriebMelden(grund, 'Probe');
  l.stoerung({ art: 'debug', nr: 1, startTick: 0 }, LLM.llmError('ENOENT', 'x'), null);
  ok(hinweise(g).length === 0 && logZeilen(g).length === 0, 'kein Hinweis, auch nicht bei direktem Aufruf mit jedem Grund und einer Stoerung');
  ok(angebote(g) >= 1 && g.fehler.length === 0, 'Brett liefert weiter, keine Fehler');
  ok(prozesse.length === 0, 'kein CLI-Prozess');
});

section('(d) Betrieb aus: kein Hinweis', async () => {
  const g = bauGame({ env: ENV_OHNE_CLI });
  g.handleMessage(g.conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  for (let k = 0; k < 5; k++) g.step();
  const aus = LS.create(g, { mode: 'off', env: Object.assign({}, g.env, { SPIELLEITER_RUECKFALL: undefined }) });
  ok(aus.mode === 'off' && !aus.rueckfallBetrieb, 'Objekt im Betrieb aus');
  aus.update(0); aus.beiGrenze('andocken'); aus.planErzwingen();
  aus.stoerung({ art: 'x', nr: 1, startTick: 0 }, LLM.llmError('RATE_LIMIT', '429'), null);
  ok(aus.notbetriebMelden('ENOENT') === false && hinweise(g).length === 0 && logZeilen(g).length === 0, 'mode off: kein Hinweis');
  const mock = LS.create(g, { mode: 'mock', env: g.env });
  mock.update(0); mock.stoerung({ art: 'x', nr: 1, startTick: 0 }, LLM.llmError('RATE_LIMIT', '429'), null);
  ok(hinweise(g).length === 0, 'mode mock (Tests und Entwicklung): kein Hinweis');
  const h = bauGame({ szenarioSchalter: false, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'off' } });
  h.handleMessage(h.conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  h.handleMessage(h.conn, { t: 'ready', ready: true });
  for (let k = 0; k < 5; k++) h.step();
  ok(!h.lageSpielleiter && hinweise(h).length === 0, 'SPIELLEITER_LLM=off ohne Szenario: kein Objekt, kein Hinweis');
  ok(prozesse.length === 0, 'kein CLI-Prozess');
});

section('(e) zweite Sitzung, Weltstand unveraendert', async () => {
  const dir = frisch();
  const g = bauGame({ dir, env: ENV_OHNE_CLI });
  g.lobbyOpts.liveSpielleiter = true;
  g.handleMessage(g.conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  g.step();
  ok(hinweise(g).length === 1, 'Sitzung 1: ein Hinweis');
  const l1 = g.lageSpielleiter;
  l1.opts.transport = stubFehler('RATE_LIMIT'); l1.llm = null;
  await aufrufe(g);
  ok(l1.notbetriebGemeldet === true && hinweise(g).length === 1, 'Flag gesetzt, weiter ein Hinweis');
  springe(g, 3);
  ok(Weltstand.save(g).ok, 'Weltstand gespeichert');
  const id = g.weltstand && g.weltstand.id;
  const roh = fs.readFileSync(path.join(dir, id + '.json'), 'utf8');
  ok(!/notbetrieb|Notbetrieb|startGeprueft/.test(roh), 'Flag steht nicht im Weltstand');
  const keysMit = Object.keys(JSON.parse(roh).welt.sim).sort().join(',');
  const sn = JSON.stringify(g.snapshot());
  ok(!/notbetrieb|startGeprueft/i.test(sn), 'Flag steht nicht im Snapshot');
  g.zurLobby();
  ok(g.lageSpielleiter === null, 'zurLobby: Lage-Spielleiter weg (und mit ihm das Flag)');
  g.funk.length = 0; g.logs.length = 0;
  g.lobbyOpts.liveSpielleiter = true; g.lobbyOpts.world = null;   // neue Welt (die Lobby merkt sich sonst den gerade gespeicherten Stand: Fortsetzen ist nie live)
  g.handleMessage(g.conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  g.step();
  ok(g.lageSpielleiter && g.lageSpielleiter !== l1 && g.lageSpielleiter.notbetriebGemeldet === true && hinweise(g).length === 1 && logZeilen(g).length === 1, 'Sitzung 2 (neue Welt): meldet wieder genau einmal');
  g.lageSpielleiter.opts.transport = stubFehler('ETIMEDOUT'); g.lageSpielleiter.llm = null;
  await aufrufe(g); await aufrufe(g);
  ok(hinweise(g).length === 1, 'Sitzung 2: weiter genau einer');
  g.zurLobby();
  // Fortsetzen des Standes ist nie live: kein Hinweis, Stand laedt heil, Bloecke unveraendert
  const h = bauGame({ dir, env: ENV_OHNE_CLI });
  h.refreshWorldList();
  h.handleMessage(h.conn, { t: 'lobbyOpt', world: id });
  h.handleMessage(h.conn, { t: 'ready', ready: true });
  for (let k = 0; k < 40; k++) h.step();
  ok(h.phase === 'play' && hinweise(h).length === 0 && h.fehler.length === 0, 'Fortsetzen: Rueckfall-Betrieb, kein Hinweis, keine Fehler');
  Weltstand.save(h);
  const nach = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  ok(Object.keys(nach.welt.sim).sort().join(',') === keysMit && nach.version === 3, 'Bloecke von welt.sim und Version unveraendert (' + keysMit + ')');
  h.zurLobby();
});

section('(f) Funktext aus den Daten', async () => {
  const g = startLive(ENV_MIT_CLI, stubText('{}'));
  const l = LS.create(g, { mode: 'live', env: g.env, transport: stubText('{}'), cliFinden: () => ({ cmd: null, versucht: ['/x'] }), werte: { notbetrieb_funk: { sprecher: 'Testsprecher', text: 'Testtext Notbetrieb.', log: 'Log {grund}{detail}' } } });
  const vor = g.funk.length;
  l.update(0);
  const neu = g.funk.slice(vor);
  ok(neu.length === 1 && neu[0].text === 'Testtext Notbetrieb.' && neu[0].from === 'Testsprecher' && neu[0].lage === 1 && neu[0].r === 1, 'Text und Sprecher kommen aus den Daten (ueberschrieben per werte)');
  ok(logZeilen(g).length === 0 && g.logs.some((z) => /Log cli_fehlt: versucht: \/x/.test(z)), 'Logzeile aus der Daten-Vorlage mit Grund und Detail');
  l.dispose();
  const g2 = startLive(ENV_OHNE_CLI);
  ok(hinweise(g2)[0] && hinweise(g2)[0].text === T.text && hinweise(g2)[0].from === T.sprecher && !g2.funk.some((f) => /\bBot\b/.test(f.text || '')), 'Standardtext aus content/welt/notbetrieb-hinweis.json, ohne Spielername');
  g.zurLobby(); g2.zurLobby();
});

section('(g) Rueckfall liefert weiter das Angebot', async () => {
  const g = startLive(ENV_MIT_CLI, stubFehler('RATE_LIMIT'));
  springe(g, 8);
  await aufrufe(g);
  const l = g.lageSpielleiter;
  ok(hinweise(g).length === 1, 'Hinweis einmal');
  ok(!!l && Faden.spielleiterAktiv(g), 'spielleiterAktiv trotz Ausfall');
  // aufrufe() raeumt die Angebote leer (Platz fuer den Abenteuer-Aufruf): der Rueckfall (Anschluss-Garantie, anschluss.json) legt eines nach
  g.weltsim.faeden.abenteuerAngebote.length = 0;
  const ab = Brett.anschluss(g);
  ok(!!ab && angebote(g) >= 1, 'anschluss() legt trotz Ausfall ein Angebot aus anschluss.json nach (' + angebote(g) + ')');
  const bs = Brett.snapshot(g);
  ok(bs && bs.ok === 1 && bs.angebote.length >= 1, 'Brett-Snapshot ok:1 mit Angebot (' + (bs ? bs.angebote.length : 0) + ')');
  ok(g.fehler.length === 0 && g.errors === 0, 'keine Serverfehler ' + g.fehler.join('|'));
  g.zurLobby();
});

(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
  }
  ok(JSON.stringify(Object.assign({}, process.env)) === ENV_VOR, 'process.env am Ende unveraendert');
  ok(prozesse.length === 0, 'nie ein Kindprozess (Spion: ' + prozesse.length + ')');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Temp */ }
  console.log('\n' + (n - fails) + ' von ' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
