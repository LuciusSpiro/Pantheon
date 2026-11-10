'use strict';
// LIV-01 A1 / LIV-02 P1: Kontingent-Schranke (server/sim/kontingent.js, Gate in Lage-, Abenteuer- und Missions-Spielleiter, Befehle kontingent.freigeben und kontingent.ablehnen). Offline: Fake-Transport, Spion auf child_process.
//   (1) Schwelle: 449 999 fragt, 450 000 fragt nicht (kein CLI-Prozess), Systemzeile und Logbuch genau einmal, KEIN Funk, KEIN world.kontingent   (2) Freigabe +500 000, fragt wieder, naechste Schwelle erneut genau einmal
//   (3) nur der Spieler mit color 0, Doppeldruck   (4) spielbar mit erreichtem Kontingent   (5) kleines Limit 60 000   (6) ohne Live-Schalter: keine Frage, Snapshot unveraendert
//   (7) Frage: nur an color 0, einmal je Schwelle, offen bis zur Antwort (erneut bei Beitritt/Wiederverbinden), Ja/Nein, Nein ist Nein, neue Frage bei neuer Schwelle
//   node tools/test-kontingent.js   (npm run test:kontingent)
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));
// Spion VOR dem Laden der Module: jeder gestartete Prozess steht in prozesse
const prozesse = [];
for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const orig = cp[fn];
  cp[fn] = function (...a) { prozesse.push(fn + ' ' + String(a[0]).slice(0, 60)); return orig.apply(this, a); };
}
// N2: nichts ins Repo und nichts dauerhaft nach %TEMP%: alle Logbuecher dieses Tests liegen in EINEM selbst angelegten Ordner, der am Ende geloescht wird
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'liv01-kont-'));
const REGIE = path.join(TMP, 'regie');
const repoDatei = path.join(process.cwd(), 'data', 'regie', 'w-kontingent.jsonl');
const dateiStand = () => { try { const st = fs.statSync(repoDatei); return st.size + '|' + st.mtimeMs; } catch (e) { return 'fehlt'; } };
const tempOrdner = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('liv01-regie-')).length;
const vorher = { datei: dateiStand(), ordner: tempOrdner() };
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
const LLM = require('../server/mission/llm.js');
const Kontingent = require('../server/sim/kontingent.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Spielleiter = require('../server/mission/spielleiter.js');
const Katalog = require('./katalog.js');
const Context = require('../server/mission/context.js');
const Archiv = require('../server/mission/archiv.js');
const CONFIG = require('../shared/config.js');
const X = require('./faden-fixture.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const frei = () => new Promise((r) => setImmediate(r));
const LIVE = { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'live', LLM_LIVE: '1', FAEDEN: '1', ABENTEUER_ANSCHLUSS: '0' };
const MELDUNG = /Kontingent/i;   // LIV-02: es darf KEIN Funk mit Kontingent-Text mehr entstehen
const PRAEFIX = '[Kontingent] ';

process.env.LLM_LIVE = '1';

// Fake-Transport: zaehlt jede Anfrage nach Art, antwortet mit einem leeren (ungueltigen) Plan; die Tokens setzen die Tests selbst (addUsage)
function fakeTransport() {
  const t = { name: 'fake', gefragt: [], call: async (text, co) => { t.gefragt.push(co.kind); return { text: '{}', usage: { input: 0, output: 0 }, sec: 0, anbieter: 'claude' }; } };
  return t;
}
function neuesSpiel(env) {
  const t = X.spiel({ names: ['ZEBRAKAI'], env: Object.assign({}, LIVE, env || {}) });
  const p = t.g.players[0]; p.console = 'captain'; p.zone = 'ship';
  return mitLog(t);
}
// game.log sammeln (das Fixture legt logFn fest und die Systemzeile kann schon im Fixture-Lauf entstehen): Game.prototype.log merkt sich jede Zeile je Spiel
require('../server/game.js').Game.prototype.log = function (...a) { (this.zeilen || (this.zeilen = [])).push(a.join(' ')); };
function mitLog(t) { return t; }
const sys = (t) => (t.g.zeilen || []).filter((z) => z.startsWith(PRAEFIX));
const fragen = (c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'kontingentFrage');
const erledigt = (c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'kontingentErledigt');
const snapMitFeld = (g, n) => { for (let i = 0; i < (n || 40); i++) { const s = g.snapshot(); if ('kontingent' in s.world || JSON.stringify(s).includes('"kontingent"')) return true; } return false; };
function mitLage(t) {
  const tr = fakeTransport();
  const llm = LLM.create({ mode: 'live', transport: tr });
  const sl = LS.create(t.g, { llm, werte: { deckel_je_sitzung: 1e9, min_abstand_ticks: 0 }, abenteuerWerte: { deckel_je_sitzung: 1e9, cooldown_grenzen: 0 } });
  t.g.lageSpielleiter = sl; t.g.lageSchalter = true;
  return { sl, ab: sl.abenteuer, tr, llm };
}
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
const funk = (t) => t.cs.reduce((a, c) => a.concat(c.inbox.filter((m) => m.t === 'event' && m.kind === 'radio' && typeof m.text === 'string' && MELDUNG.test(m.text))), []);
const logs = (g, ausgang) => (g.lageRegie ? g.lageRegie.log.entries : []).filter((e) => e.art === 'kontingent' && (ausgang === undefined || e.ausgang === ausgang));
const antworten = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'kontingentAntwort');
const cmd = (t, c) => t.g.handleMessage(t.cs[0], { t: 'cmd', c: c || 'kontingent.freigeben' });
const gesetzt = (used, limit) => { LLM.resetBudget(); if (limit != null) LLM.setBudgetLimit(limit); if (used) LLM.addUsage(used); };
// eine Anfrage des Lage-Spielleiters / des Abenteuer-Spielleiters; danach abwarten, bis die Antwort abgeholt ist
async function lageFragt(t, m) { const r = m.sl.planErzwingen(); await pumpen(t.g, 4); return r; }
async function abenteuerFragt(t, m) { const r = m.ab.erzwingen(); await pumpen(t.g, 4); return r; }
const gefragt = (m, kind) => m.tr.gefragt.filter((k) => k === kind).length;

// ---------- Missions-Spielleiter (Kampagne), wie test-spielleiter.js (Pipeline, Rueckfaelle) ----------
function fakeGame() {
  const events = [], errors = [], zeilen = [];
  const g = {
    time: 0, C: CONFIG, env: Object.assign({}, LIVE, { REGIE_DIR: REGIE }), players: [{ connected: true }],
    ship: { scene: 'hafen' },
    emit(k, d) { events.push({ k, d }); }, oda() {}, notice() {}, countError(w, e) { errors.push(w + ': ' + (e && e.message)); }, log(...a) { zeilen.push(a.join(' ')); },
    weltstand: { id: 'w-kontingent', persistent: true, data: null, npcMemory() { return true; } },
  };
  const m = {
    books: {}, activeId: null, step: null, missions: {}, order: ['m1', 'm2', 'm3'],
    info(id) { return ['m1', 'm2', 'm3'].includes(id) ? { id, tutorial: true } : (this.books[id] ? { id, tutorial: false } : null); },
    registerBook(b, o) { this.books[b.id] = { book: b, origin: o && o.origin }; return { ok: true, errors: [] }; },
    updateBook() { return { ok: true }; }, unregisterBook(id) { delete this.books[id]; },
    startMission() {}, radio() {}, playTime() { return g.time; },
  };
  for (const id of m.order) m.missions[id] = { state: 'done' };
  g.mission = m;
  return { g, events, errors, zeilen };
}
async function missionLauf(katalog, ctx, archiv) {
  const F = fakeGame();
  const tr = fakeTransport();
  const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'live', katalog, transport: tr }), kontext: () => ctx, archiv, regieDir: fs.mkdtempSync(path.join(TMP, 'r-')), katalog, config: { offers: 1 } });
  sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
  for (let t = 0; t < 12; t += 0.5) { F.g.time += 0.5; sl.update(0.5); await frei(); if (sl.offers().length >= 2) break; }
  return { sl, tr, F };
}
const missionFunk = (ml) => ml.F.events.filter((e) => e.k === 'radio' && MELDUNG.test(String(e.d.text))).length;
const missionSys = (ml) => ml.F.zeilen.filter((z) => z.startsWith(PRAEFIX)).length;

section('Schwelle: 449 999 fragt, 450 000 fragt nicht (alle drei Spielleiter), Systemzeile und Logbuch genau einmal, kein Funk', async () => {
  gesetzt(0);
  ok(LLM.budget().limit === 500000 && Kontingent.schwelle() === 450000, 'Standard: Limit 500 000, Schwelle 450 000');
  const katalog = Katalog.load({}), ctx = Context.build({}, {}, katalog), archiv = Archiv.load().entries;
  ok(archiv.length > 0, 'Archiv fuer den Rueckfall des Missions-Spielleiters vorhanden');
  // ---- Lage und Abenteuer
  gesetzt(449999);
  const t = neuesSpiel(), m = mitLage(t);
  ok(!Kontingent.erreicht() && !Kontingent.sperrt(t.g, 30000), '449 999: nicht erreicht');
  let r = await lageFragt(t, m);
  ok(r.gestartet && gefragt(m, 'lage') === 1, 'Lage-Spielleiter fragt bei 449 999');
  r = await abenteuerFragt(t, m);
  ok(r.gestartet && gefragt(m, 'abenteuer') === 1, 'Abenteuer-Spielleiter fragt bei 449 999');
  ok(sys(t).length === 0 && logs(t.g).length === 0, 'noch keine Meldung');
  LLM.addUsage(1);   // genau 450 000
  ok(LLM.budget().used === 450000 && Kontingent.erreicht(), '450 000: erreicht');
  const vor = prozesse.length;
  const lageVor = gefragt(m, 'lage'), abVor = gefragt(m, 'abenteuer');
  // zweites Spiel mit dem ECHTEN CLI-Transport: ein Aufruf wuerde einen Prozess starten (Spion)
  const echt = LLM.create({ mode: 'live' });
  let echtAsks = 0; const ask0 = echt.ask.bind(echt); echt.ask = (k, i, o) => { echtAsks++; return ask0(k, i, o); };
  const t2 = neuesSpiel(), m2 = mitLage(t2); m2.sl.llm = echt; m2.sl.getLlm = () => echt;
  r = await lageFragt(t, m);
  ok(!r.gestartet && r.grund === 'budget' && gefragt(m, 'lage') === lageVor, '450 000: Lage-Spielleiter faellt auf den Rueckfall (grund budget), keine Anfrage');
  r = await abenteuerFragt(t, m);
  ok(!r.gestartet && r.grund === 'budget' && gefragt(m, 'abenteuer') === abVor, '450 000: Abenteuer-Spielleiter fragt nicht (grund budget)');
  r = await lageFragt(t2, m2); const r2 = await abenteuerFragt(t2, m2);
  ok(!r.gestartet && !r2.gestartet && echtAsks === 0 && prozesse.length === vor, `echter CLI-Transport: keine Anfrage (${echtAsks}), kein Prozess gestartet (Spion: ${prozesse.length - vor})`);
  await pumpen(t.g, 30);
  ok(sys(t).length === 1 && sys(t2).length === 1, 'Systemzeile „[Kontingent] ...“ genau einmal je Spiel trotz vieler Pruefungen und Schritte');
  ok(funk(t).length === 0 && funk(t2).length === 0, 'KEIN Funk mit Kontingent-Text');
  ok(logs(t.g, 'erreicht').length === 1, 'Regie-Logbuch: ein Eintrag „erreicht“');
  ok(!snapMitFeld(t.g) && !snapMitFeld(t2.g), 'Snapshot enthaelt world.kontingent nie, auch live und erreicht');
  // ---- Missions-Spielleiter
  gesetzt(449999);
  let ml = await missionLauf(katalog, ctx, archiv);
  ok(ml.tr.gefragt.includes('grobplan'), 'Missions-Spielleiter fragt bei 449 999 (Grobplan)');
  gesetzt(450000);
  const vor3 = prozesse.length;
  ml = await missionLauf(katalog, ctx, archiv);
  const rueck = ml.sl.regie ? ml.sl.regie.entries.filter((e) => e.art === 'rueckfall') : [];
  ok(ml.tr.gefragt.length === 0 && prozesse.length === vor3, 'Missions-Spielleiter bei 450 000: keine Anfrage, kein Prozess');
  ok(rueck.length >= 1 && ml.sl.offers().some((o) => o.origin === 'archiv') && ml.F.errors.filter((e) => !/fallback|mock/.test(e)).length === 0, `Missions-Spielleiter: Rueckfall aufs Archiv, Angebote ${ml.sl.offers().map((o) => o.id + '[' + o.origin + ']').join(',')}, Rueckfall ${rueck.length}, keine fremden Fehler (${ml.F.errors.join('|').slice(0, 120)})`);
  ok(missionSys(ml) === 1 && missionFunk(ml) === 0, 'Missions-Spielleiter-Spiel: Systemzeile genau einmal, kein Funk');
  LLM.resetBudget();
});

section('Freigabe: Limit und Schwelle +500 000, Spielleiter fragen wieder, neue Schwelle meldet erneut genau einmal', async () => {
  gesetzt(450000);
  const t = neuesSpiel(), m = mitLage(t);
  await pumpen(t.g, 3);
  ok(Kontingent.erreicht() && sys(t).length === 1, 'Ausgangslage: erreicht, eine Systemzeile');
  cmd(t);
  const b = LLM.budget();
  ok(b.limit === 1000000 && Kontingent.schwelle() === 950000 && b.used === 450000, `Limit ${b.limit}, Schwelle ${Kontingent.schwelle()}, Zaehler unveraendert`);
  const a = antworten(t);
  ok(a.length === 1 && a[0].ok === true && a[0].pid === t.g.players[0].id, 'Antwort kontingentAntwort ok an den Absender');
  ok(logs(t.g, 'freigabe').length === 1, 'Regie-Logbuch: ein Eintrag „freigabe“');
  let r = await lageFragt(t, m);
  ok(r.gestartet && gefragt(m, 'lage') === 1, 'Lage-Spielleiter fragt wieder');
  r = await abenteuerFragt(t, m);
  ok(r.gestartet && gefragt(m, 'abenteuer') === 1, 'Abenteuer-Spielleiter fragt wieder');
  const katalog = Katalog.load({}), ctx = Context.build({}, {}, katalog);
  const ml = await missionLauf(katalog, ctx, Archiv.load().entries);
  ok(ml.tr.gefragt.includes('grobplan'), 'Missions-Spielleiter fragt wieder');
  LLM.addUsage(499999);   // 949 999
  await pumpen(t.g, 5);
  ok(!Kontingent.erreicht() && sys(t).length === 1, '949 999: nicht erreicht, keine neue Systemzeile');
  ok((await lageFragt(t, m)).gestartet, '949 999: Lage fragt');
  LLM.addUsage(1);   // 950 000
  await pumpen(t.g, 5);
  ok(Kontingent.erreicht() && sys(t).length === 2 && logs(t.g, 'erreicht').length === 2 && funk(t).length === 0, '950 000: Systemzeile erneut (zwei insgesamt), zweiter Logbuch-Eintrag, kein Funk');
  const vor = gefragt(m, 'lage');
  const r2 = await lageFragt(t, m);
  ok(!r2.gestartet && gefragt(m, 'lage') === vor, '950 000: Lage-Spielleiter fragt nicht mehr');
  await pumpen(t.g, 30);
  ok(sys(t).length === 2, 'weitere Schritte melden nicht noch einmal');
  LLM.resetBudget();
});

section('Rechte: nur der Spieler mit color 0, Doppeldruck erhoeht nicht doppelt', async () => {
  gesetzt(450000);
  const t = mitLog(X.spiel({ names: ['ZEBRAKAI', 'Mireille_Kas', 'Ouzo_Brandt'], crew: 3, env: LIVE }));
  const rollen = ['captain', 'weapons', 'technik'];
  t.g.players.forEach((p, i) => { p.zone = 'ship'; p.console = rollen[i]; });
  ok(t.g.players.map((p) => p.color).join() === '0,1,2', 'Farben der drei Spieler: 0, 1, 2');
  await pumpen(t.g, 3);
  for (const c of ['kontingent.freigeben', 'kontingent.ablehnen']) { t.g.handleMessage(t.cs[1], { t: 'cmd', c }); t.g.handleMessage(t.cs[2], { t: 'cmd', c }); }
  ok(LLM.budget().limit === 500000 && Kontingent.schwelle() === 450000, 'Spieler mit color 1 und 2: keine Freigabe (Limit und Schwelle unveraendert)');
  ok([t.cs[1], t.cs[2]].every((c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'notice').length >= 2 && !c.inbox.some((m) => m.kind === 'kontingentAntwort' || m.kind === 'kontingentErledigt')), 'andere Spieler bekommen die Absage (notice), keine kontingentAntwort');
  ok(logs(t.g, 'freigabe').length === 0 && logs(t.g, 'abgelehnt').length === 0 && t.g.kontingent.frage.offen === true, 'keine Freigabe/Ablehnung im Logbuch, Frage bleibt offen');
  // color 0 genuegt, die Konsole zaehlt nicht mehr
  t.g.players[0].console = null;
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
  const a = antworten(t);
  ok(LLM.budget().limit === 1000000 && Kontingent.schwelle() === 950000, 'color 0 (ohne Konsole), zweimal gedrueckt: genau +500 000');
  ok(a.length === 2 && a[0].ok === true && a[0].op === 'freigeben' && a[1].ok === false && a[1].code === 'nicht_erreicht' && typeof a[1].text === 'string', 'erste Antwort ok, zweite nicht_erreicht mit Text');
  ok(logs(t.g, 'freigabe').length === 1, 'genau eine Freigabe im Logbuch');
  // nicht erreicht: auch color 0 bewirkt nichts
  gesetzt(1000);
  const t2 = neuesSpiel();
  t2.g.handleMessage(t2.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
  ok(LLM.budget().limit === 500000 && antworten(t2)[0].code === 'nicht_erreicht', 'vor dem Erreichen: nicht_erreicht, Limit bleibt');
  t2.g.handleMessage(t2.cs[0], { t: 'cmd', c: 'kontingent.ablehnen' });
  ok(antworten(t2)[1].ok === false && antworten(t2)[1].code === 'keine_frage', 'vor dem Erreichen: ablehnen -> keine_frage');
  LLM.resetBudget();
});

section('Spielbarkeit: mit erreichtem Kontingent laeuft das Spiel, nichts blockiert', async () => {
  gesetzt(450000);
  const t = neuesSpiel(), m = mitLage(t);
  const ws = t.g.weltsim, tick0 = ws.tickZahl, zeit0 = t.g.time;
  for (let i = 0; i < 25; i++) { Kriegslage.tick(t.g, 'test'); if (i % 5 === 0) m.sl.beiGrenze('andocken'); await pumpen(t.g, 2); }
  ok(ws.tickZahl >= tick0 + 25 && t.g.time > zeit0, 'Tick und Spielzeit laufen weiter');
  ok(t.g.errors === 0, `keine Serverfehler (${t.g.errors})`);
  ok(m.sl.zustand === 'idle' && m.ab.zustand === 'idle' && m.tr.gefragt.length === 0, 'Spielleiter idle, nichts gefragt, nichts haengt');
  const rueck = t.g.lageRegie.log.entries.filter((e) => e.art === 'lage_befehl' && e.ausgang === 'rueckfall');
  ok(rueck.length === 1 && /Kontingent erreicht/.test(rueck[0].begruendung), 'Rueckfall genau einmal im Logbuch, Grund „Kontingent erreicht“');
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'helm.stop' });
  ok(!!t.g.snapshot() && t.g.errors === 0, 'Befehle und Snapshots laufen weiter');
  LLM.resetBudget();
});

section('Kleines Limit 60 000: Schwelle 54 000, min_budget-Deckel greift', async () => {
  gesetzt(0, 60000);
  ok(Kontingent.schwelle() === 54000 && Kontingent.mindestRest(30000) === 6000, 'Schwelle 54 000, mindestRest 6 000 (statt 30 000)');
  LLM.addUsage(40000);   // Rest 20 000 < 30 000: ohne Deckel laengst gestoppt
  const t = neuesSpiel(), m = mitLage(t);
  let r = await lageFragt(t, m);
  ok(r.gestartet, 'bei 40 000 (Rest 20 000 < min_budget 30 000) fragt der Spielleiter noch');
  LLM.addUsage(13999);   // 53 999
  r = await lageFragt(t, m);
  ok(r.gestartet && sys(t).length === 0, '53 999: fragt, keine Meldung');
  LLM.addUsage(1);   // 54 000
  await pumpen(t.g, 3);
  r = await lageFragt(t, m);
  ok(!r.gestartet && sys(t).length === 1, '54 000: gesperrt, Systemzeile kommt');
  cmd(t);
  ok(LLM.budget().limit === 560000 && Kontingent.schwelle() === 554000, 'Freigabe: Limit 560 000, Schwelle 554 000');
  ok((await lageFragt(t, m)).gestartet, 'danach fragt der Spielleiter wieder');
  // Limit unter min_budget: das alte Gate bleibt (Anfragen waeren ohnehin unmoeglich)
  gesetzt(0, 20000);
  ok(Kontingent.mindestRest(30000) === 30000 && Kontingent.sperrt({}, 30000), 'Limit <= min_budget: min_budget gilt unveraendert');
  LLM.resetBudget();
});

// ---------- M1/M2: Eskalation und Text-Pool (jeder Claude-Weg fragt das Gate) ----------
// Router-Fake: Stufe bei Ollama, Eskalation an Claude erlaubt. call = Ollama (ungueltige Antwort), callEskalation = Claude (zaehlt).
function ollamaMitEskalation() {
  const t = { name: 'fake-router', gefragt: [], eskaliert: [], anbieterFuer: () => 'ollama', eskalationFuer: () => 'claude',
    call: async (text, co) => { t.gefragt.push(co.kind); return { text: '{}', usage: { input: 0, output: 0 }, sec: 0, anbieter: 'ollama', modell: 'fake' }; },
    callEskalation: async (text, co) => { t.eskaliert.push(co.kind); return { text: '{}', usage: { input: 0, output: 0 }, sec: 0, anbieter: 'claude', eskaliert: true }; } };
  return t;
}
section('M1: Abenteuer-Spielleiter eskaliert nach Erreichen der Schwelle nie an Claude (Stufe bei Ollama)', async () => {
  const lauf = async (used, nachStart) => {
    gesetzt(used);
    const t = neuesSpiel(), tr = ollamaMitEskalation();
    const llm = LLM.create({ mode: 'live', transport: tr });
    const sl = LS.create(t.g, { llm, werte: { deckel_je_sitzung: 1e9, min_abstand_ticks: 0 }, abenteuerWerte: { deckel_je_sitzung: 1e9, cooldown_grenzen: 0 } });
    t.g.lageSpielleiter = sl; t.g.lageSchalter = true;
    const r = sl.abenteuer.erzwingen();
    if (nachStart) LLM.addUsage(nachStart);
    await pumpen(t.g, 6);
    return { r, tr };
  };
  let x = await lauf(0, 0);
  ok(x.r.gestartet && x.tr.gefragt.length === 1 && x.tr.eskaliert.length === 1, 'Kontrolle unter der Schwelle: Ollama fragt, die ungueltige Antwort eskaliert einmal an Claude');
  x = await lauf(449999, 1);   // Job laeuft, waehrenddessen wird die Schwelle erreicht
  ok(x.r.gestartet && x.tr.gefragt.length === 1 && x.tr.eskaliert.length === 0, `Schwelle waehrend des Jobs erreicht: Ollama antwortete, KEINE Eskalation an Claude (${x.tr.eskaliert.length})`);
  x = await lauf(450000, 0);
  ok(x.r.gestartet && x.tr.gefragt.length === 1 && x.tr.eskaliert.length === 0, `Schwelle schon erreicht: Ollama-Pfad bleibt frei (${x.tr.gefragt.length}), keine Eskalation (${x.tr.eskaliert.length})`);
  LLM.resetBudget();
});

const Pool = require('../server/sim/texte-pool.js');
function textLlm(o) {
  const l = { mode: 'live', asks: [], esk: [], anbieterFuer: () => o.anbieter, eskalationMoeglich: () => !!o.eskalation,
    async ask(kind, input) { l.asks.push(kind); if (o.ausfall) throw Object.assign(new Error('Fake-Ausfall'), { code: 'EXIT' }); return { text: JSON.stringify({ text: 'x' }), tokens: 0, sec: 0, anbieter: o.anbieter }; },
    async eskaliere(kind) { l.esk.push(kind); return { text: JSON.stringify({ text: 'x' }), tokens: 0, sec: 0, anbieter: 'claude', eskaliert: true }; } };
  return l;
}
section('M2: Text-Pool fragt das Gate vor jedem Claude-Weg (Stufe bei Claude, Eskalation), Ollama bleibt frei', async () => {
  const lauf = async (used, o) => {
    gesetzt(used);
    Pool.zuruecksetzen();
    const t = X.spiel({ names: ['ZEBRAKAI'], env: Object.assign({}, LIVE, { TEXTE_POOL: '1' }) });
    const llm = textLlm(o); Pool.setLlm(llm);
    Pool.beiGrenze(t.g); Pool.update(t.g, 0.1); await Pool.jobFertig();
    Pool.zuruecksetzen();
    return llm;
  };
  let l = await lauf(0, { anbieter: 'claude' });
  ok(l.asks.length > 0, 'Kontrolle unter der Schwelle: Stufe bei Claude fragt');
  l = await lauf(450000, { anbieter: 'claude' });
  ok(l.asks.length === 0 && l.esk.length === 0, `Schwelle erreicht, Stufe bei Claude: keine Anfrage (${l.asks.length}), keine Eskalation (${l.esk.length})`);
  l = await lauf(0, { anbieter: 'ollama', eskalation: true });
  ok(l.asks.length > 0 && l.esk.length === 1, `Kontrolle: ungueltige Ollama-Antworten eskalieren unter der Schwelle einmal (${l.esk.length})`);
  l = await lauf(450000, { anbieter: 'ollama', eskalation: true });
  ok(l.asks.length > 0 && l.esk.length === 0, `Schwelle erreicht: Ollama fragt weiter (${l.asks.length}), die Eskalation nach ungueltiger Antwort bleibt aus (${l.esk.length})`);
  l = await lauf(450000, { anbieter: 'ollama', eskalation: true, ausfall: true });
  ok(l.asks.length > 0 && l.esk.length === 0, `Schwelle erreicht, Ollama-Ausfall: keine Eskalation an Claude (${l.esk.length})`);
  l = await lauf(0, { anbieter: 'ollama', eskalation: true, ausfall: true });
  ok(l.esk.length > 0, 'Kontrolle: Ollama-Ausfall eskaliert unter der Schwelle');
  LLM.resetBudget();
});

// ---------- LIV-02: die Frage „Limit erhoehen?“ ----------
const neuC = () => ({ inbox: [], send(m) { if (this.inbox.length < 2000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } });
const pumpS = async (g, k) => { for (let i = 0; i < k; i++) { g.step(); if (g.wantsSnapshot()) g.broadcast(g.snapshot()); await frei(); } };   // wie server/index.js
const crew3 = () => { const t = mitLog(X.spiel({ names: ['ZEBRAKAI', 'Mireille_Kas', 'Ouzo_Brandt'], crew: 3, env: LIVE })); t.g.players.forEach((p) => { p.zone = 'ship'; }); return t; };
const sende = (t, i, c) => t.g.handleMessage(t.cs[i], { t: 'cmd', c });

section('Frage: nur an color 0, einmal je Schwelle, kein Zaehlerstand im Payload', async () => {
  gesetzt(449999);
  const t = crew3();
  await pumpS(t.g, 10);
  ok(t.cs.every((c) => fragen(c).length === 0), '449 999: keine Frage');
  LLM.addUsage(1);
  await pumpS(t.g, 40);
  ok(fragen(t.cs[0]).length === 1 && fragen(t.cs[1]).length === 0 && fragen(t.cs[2]).length === 0, '450 000: genau eine Frage, nur an den Spieler mit color 0');
  const f = fragen(t.cs[0])[0];
  ok(Object.keys(f).sort().join() === 'kind,pid,t' && f.pid === t.g.players[0].id, 'Payload exakt { t:event, kind:kontingentFrage, pid } ohne Zahlen: ' + JSON.stringify(f));
  ok(sys(t).length === 1 && logs(t.g, 'erreicht').length === 1 && funk(t).length === 0, 'eine Systemzeile, ein Logbuch-Eintrag, kein Funk');
  ok(t.cs.every((c) => !c.inbox.some((m) => m.t === 'snap' && m.world && 'kontingent' in m.world)), 'kein Snapshot mit world.kontingent bei irgendeiner Verbindung');
  await pumpS(t.g, 60);
  ok(fragen(t.cs[0]).length === 1 && sys(t).length === 1, 'viele weitere Schritte: keine zweite Frage, keine zweite Zeile');
  LLM.resetBudget();
});

section('Frage: Ja schliesst sie, neue Schwelle fragt genau einmal neu', async () => {
  gesetzt(450000);
  const t = crew3();
  await pumpS(t.g, 10);
  ok(fragen(t.cs[0]).length === 1, 'Ausgangslage: Frage offen');
  sende(t, 0, 'kontingent.freigeben');
  ok(LLM.budget().limit === 1000000 && Kontingent.schwelle() === 950000, 'Ja: Limit 1 000 000, Schwelle 950 000');
  const a = t.cs[0].inbox.filter((m) => m.kind === 'kontingentAntwort');
  ok(a.length === 1 && a[0].ok === true && erledigt(t.cs[0]).length === 1 && erledigt(t.cs[0])[0].pid === t.g.players[0].id, 'kontingentAntwort ok und kontingentErledigt an den Absender');
  ok(t.cs[1].inbox.every((m) => m.kind !== 'kontingentErledigt') && t.g.kontingent.frage.offen === false, 'Erledigt nur an den Absender, Frage zu');
  sende(t, 0, 'kontingent.freigeben'); sende(t, 0, 'kontingent.ablehnen');
  ok(LLM.budget().limit === 1000000, 'Doppelklick/Nachzuegler wirkungslos (kein zweites +500 000)');
  const c0 = neuC(); t.g.addConnection(c0); t.g.handleMessage(c0, { t: 'hello', clientId: 'A0', name: 'ZEBRAKAI', color: 0 });
  await pumpS(t.g, 10);
  ok(fragen(c0).length === 0, 'Wiederverbinden nach Ja: keine erneute Frage');
  LLM.addUsage(499999); await pumpS(t.g, 10);
  ok(fragen(c0).length === 0 && sys(t).length === 1, '949 999: noch keine neue Frage');
  LLM.addUsage(1); await pumpS(t.g, 10);
  ok(fragen(c0).length === 1 && fragen(t.cs[0]).length === 1 && sys(t).length === 2, '950 000: genau eine neue Frage (an die aktuelle Verbindung von color 0)');
  LLM.resetBudget();
});

section('Frage: Nein ist Nein (keine Wiederholung, keine Freigabe, kein anderer Kanal)', async () => {
  gesetzt(450000);
  const t = crew3();
  await pumpS(t.g, 10);
  sende(t, 0, 'kontingent.ablehnen');
  const a = t.cs[0].inbox.filter((m) => m.kind === 'kontingentAntwort');
  ok(a.length === 1 && a[0].ok === true && a[0].op === 'ablehnen' && erledigt(t.cs[0]).length === 1, 'Nein: Antwort ok (op ablehnen) und kontingentErledigt');
  ok(LLM.budget().limit === 500000 && Kontingent.erreicht() && logs(t.g, 'abgelehnt').length === 1, 'Limit bleibt, Kontingent bleibt erreicht, Logbuch „abgelehnt“');
  sende(t, 0, 'kontingent.freigeben');
  const b = t.cs[0].inbox.filter((m) => m.kind === 'kontingentAntwort');
  ok(b.length === 2 && b[1].ok === false && b[1].code === 'abgelehnt' && LLM.budget().limit === 500000 && logs(t.g, 'freigabe').length === 0, 'danach kontingent.freigeben: abgewiesen (abgelehnt), Limit unveraendert');
  ok(Kontingent.freigeben(t.g) && LLM.budget().limit === 500000, 'auch Kontingent.freigeben(game) direkt: abgewiesen');
  sende(t, 0, 'kontingent.ablehnen');
  ok(t.cs[0].inbox.filter((m) => m.kind === 'kontingentAntwort').pop().code === 'keine_frage' && logs(t.g, 'abgelehnt').length === 1, 'zweites Nein: keine_frage, kein zweiter Logbuch-Eintrag');
  await pumpS(t.g, 80);
  const c0 = neuC(); t.g.addConnection(c0); t.g.handleMessage(c0, { t: 'hello', clientId: 'A0', name: 'ZEBRAKAI', color: 0 });
  await pumpS(t.g, 20);
  ok(fragen(t.cs[0]).length === 1 && fragen(c0).length === 0 && sys(t).length === 1, 'keine neue Frage fuer dieselbe Schwelle (auch nicht beim Wiederverbinden), keine zweite Zeile');
  ok((await lageFragt(t, mitLage(t))).gestartet === false, 'Spielleiter bleiben gesperrt');
  LLM.resetBudget();
});

section('Frage: offen bis zur Antwort (Wiederverbinden, Beitritt, Uebernahme)', async () => {
  gesetzt(450000);
  const t = crew3();
  await pumpS(t.g, 10);
  const c0 = neuC(); t.g.addConnection(c0); t.g.handleMessage(c0, { t: 'hello', clientId: 'A0', name: 'ZEBRAKAI', color: 0 });
  await pumpS(t.g, 10);
  const iw = c0.inbox.findIndex((m) => m.t === 'welcome'), iq = c0.inbox.findIndex((m) => m.kind === 'kontingentFrage');
  ok(fragen(c0).length === 1 && iw >= 0 && iq > iw, 'Wiederverbinden: Frage erneut, nach welcome (' + iw + ' < ' + iq + ')');
  const c1 = neuC(); t.g.addConnection(c1); t.g.handleMessage(c1, { t: 'hello', clientId: 'A1', name: 'Mireille_Kas', color: 1 });
  await pumpS(t.g, 10);
  ok(fragen(c1).length === 0, 'Wiederverbinden eines Spielers mit color 1: keine Frage');
  t.g.removeConnection(c0);
  await pumpS(t.g, 20);
  ok(t.g.kontingent.frage.offen === true && fragen(c1).length === 0 && fragen(t.cs[2]).length === 0, 'color 0 weg: Frage bleibt offen, kein anderer bekommt sie');
  const c3 = neuC(); t.g.addConnection(c3); t.g.handleMessage(c3, { t: 'hello', clientId: 'NEU3', name: 'Tzvi_Lund', color: 3 });
  await pumpS(t.g, 10);
  ok(t.g.players.length === 4 && fragen(c3).length === 0, 'Beitritt eines vierten Spielers (color 3): keine Frage');
  t.g.removeConnection(c3); t.g.removeConnection(c1);
  const c4 = neuC(); t.g.addConnection(c4); t.g.handleMessage(c4, { t: 'hello', clientId: 'NEU4', name: 'Fremder', color: 0 });
  await pumpS(t.g, 10);
  const uebernommen = t.g.players.find((p) => p.clientId === 'NEU4');
  ok(uebernommen && uebernommen.color === 0 && fragen(c4).length === 1, 'Uebernahme eines freien Platzes mit Wunschfarbe 0: der Uebernehmer (jetzt color 0) bekommt die Frage');
  LLM.resetBudget();
});

section('Frage: kein Spieler mit color 0 beim Erreichen, spaeterer Beitritt mit color 0', async () => {
  gesetzt(0);
  const t = mitLog(X.spiel({ names: ['ZEBRAKAI', 'Mireille_Kas'], crew: 2, env: LIVE }));
  t.g.players[0].color = 2; t.g.players[1].color = 1;   // niemand mit color 0
  await pumpS(t.g, 5);
  LLM.addUsage(450000);
  await pumpS(t.g, 20);
  ok(t.g.kontingent.frage.offen === true && t.cs.every((c) => fragen(c).length === 0) && sys(t).length === 1, 'niemand mit color 0: Frage offen, niemand bekommt sie, Systemzeile steht');
  sende(t, 0, 'kontingent.freigeben');
  ok(LLM.budget().limit === 500000, 'die Spieler ohne color 0 koennen nicht freigeben');
  const c = neuC(); t.g.addConnection(c); t.g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'ZEBRAKAI', color: 0 });   // gleiche clientId: Platz 1 wechselt auf color 0
  await pumpS(t.g, 10);
  ok(t.g.players[0].color === 0 && fragen(c).length === 1, 'Spieler wechselt (Wunsch) auf color 0 und verbindet: bekommt die offene Frage (' + t.g.players[0].color + ')');
  LLM.resetBudget();
});

// ---------- Snapshot: world.kontingent gibt es nicht mehr ----------
section('Snapshot: nie world.kontingent, auch live', async () => {
  for (const [used, limit] of [[0, 500000], [450000, 500000], [9999999, 9999999]]) {
    gesetzt(used, limit);
    const t = neuesSpiel();
    ok(!snapMitFeld(t.g, 60), 'live, ' + used + ' von ' + limit + ': kein world.kontingent in 60 Snapshots');
  }
  const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'kontingent.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/snapshotFeld|schluessel/.test(code), 'kontingent.js hat keinen Snapshot-Code mehr');
  LLM.resetBudget();
});

section('Ohne Live-Schalter: kein world.kontingent, Snapshot unveraendert', async () => {
  gesetzt(450000);
  for (const env of [{ SPIELLEITER_LLM: 'mock', LLM_LIVE: undefined }, { SPIELLEITER_LLM: 'live', LLM_LIVE: '0' }, { SPIELLEITER_LLM: 'off', LLM_LIVE: '1' }]) {
    const e = Object.assign({}, LIVE, env); for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    const t = neuesSpiel(e);
    await pumpen(t.g, 5);
    let gesehen = false;
    for (let i = 0; i < 60; i++) { const s = t.g.snapshot(); if ('kontingent' in s.world || JSON.stringify(s).includes('"kontingent"')) gesehen = true; }
    ok(!gesehen, `${JSON.stringify(env)}: kein world.kontingent in 60 Snapshots, obwohl der Zaehler ueber der Schwelle liegt`);
    ok(funk(t).length === 0 && fragen(t.cs[0]).length === 0, `${JSON.stringify(env)}: kein Funk, keine Frage (kein Modell zaehlt)`);
  }
  // Feldsatz von world mit und ohne erreichten Zaehler gleich
  gesetzt(0);
  const a = neuesSpiel({ SPIELLEITER_LLM: 'off' }), keysA = new Set();
  for (let i = 0; i < 20; i++) Object.keys(a.g.snapshot().world).forEach((k) => keysA.add(k));
  gesetzt(450000);
  const b = neuesSpiel({ SPIELLEITER_LLM: 'off' }), keysB = new Set();
  for (let i = 0; i < 20; i++) Object.keys(b.g.snapshot().world).forEach((k) => keysB.add(k));
  ok([...keysA].sort().join() === [...keysB].sort().join() && !keysA.has('kontingent'), 'Feldsatz von world mit und ohne erreichten Zaehler gleich');
  LLM.resetBudget();
});

section('Live: kein Snapshot-Feld bei Aenderung, kein Funk im Mitschnitt', async () => {
  gesetzt(100);
  const t = neuesSpiel(), g = t.g;
  ok(!snapMitFeld(g, 30), 'Live: kein Block bei der ersten Aenderung');
  LLM.addUsage(450000);
  ok(!snapMitFeld(g, 30), 'nach dem Erreichen: kein Block');
  const gesehen = [];
  g.mitschnitt = { vonEmit: (k, d) => { if (k === 'radio') gesehen.push(d); }, taetigkeit() {} };
  gesetzt(0); await pumpen(g, 2); LLM.addUsage(450000); await pumpen(g, 3);
  ok(gesehen.filter((d) => MELDUNG.test(String(d.text))).length === 0, 'Mitschnitt-Beobachter (vonEmit radio) sieht keine Kontingent-Meldung');
  LLM.resetBudget();
});

section('Aufraeumen: nichts ins Repo, keine liegengebliebenen Ordner in %TEMP%', async () => {
  ok(dateiStand() === vorher.datei, 'data/regie/w-kontingent.jsonl im Repo: nicht angelegt, nicht veraendert (' + vorher.datei.split('|')[0] + ' -> ' + dateiStand().split('|')[0] + ')');
  ok(tempOrdner() === vorher.ordner, 'keine neuen liv01-regie-*-Ordner in %TEMP% (' + vorher.ordner + ' -> ' + tempOrdner() + ')');
});

(async () => {
  for (const [name, fn] of abschnitte) {
    console.log('\n== ' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
  }
  console.log(`\n${n - fails}/${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})();
