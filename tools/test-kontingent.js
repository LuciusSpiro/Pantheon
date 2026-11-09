'use strict';
// LIV-01 A1: Kontingent-Schranke (server/sim/kontingent.js, Gate in Lage-, Abenteuer- und Missions-Spielleiter, Befehl kontingent.freigeben, world.kontingent). Offline: Fake-Transport, Spion auf child_process.
//   (1) Schwelle: 449 999 fragt, 450 000 fragt nicht (kein CLI-Prozess, Meldung genau einmal)   (2) Freigabe +500 000, fragt wieder, Meldung erneut bei 950 000
//   (3) nur Captain, Doppeldruck   (4) spielbar mit erreichtem Kontingent   (5) kleines Limit 60 000   (6) ohne Live-Schalter: kein Feld, Snapshot unveraendert   (7) Live-Snapshot, Mitschnitt
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
const MELDUNG = 'Kontingent aufgebraucht';

process.env.LLM_LIVE = '1';

// Fake-Transport: zaehlt jede Anfrage nach Art, antwortet mit einem leeren (ungueltigen) Plan; die Tokens setzen die Tests selbst (addUsage)
function fakeTransport() {
  const t = { name: 'fake', gefragt: [], call: async (text, co) => { t.gefragt.push(co.kind); return { text: '{}', usage: { input: 0, output: 0 }, sec: 0, anbieter: 'claude' }; } };
  return t;
}
function neuesSpiel(env) {
  const t = X.spiel({ names: ['ZEBRAKAI'], env: Object.assign({}, LIVE, env || {}) });
  const p = t.g.players[0]; p.console = 'captain'; p.zone = 'ship';
  return t;
}
function mitLage(t) {
  const tr = fakeTransport();
  const llm = LLM.create({ mode: 'live', transport: tr });
  const sl = LS.create(t.g, { llm, werte: { deckel_je_sitzung: 1e9, min_abstand_ticks: 0 }, abenteuerWerte: { deckel_je_sitzung: 1e9, cooldown_grenzen: 0 } });
  t.g.lageSpielleiter = sl; t.g.lageSchalter = true;
  return { sl, ab: sl.abenteuer, tr, llm };
}
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
const funk = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio' && typeof m.text === 'string' && m.text.startsWith(MELDUNG));
const logs = (g, ausgang) => (g.lageRegie ? g.lageRegie.log.entries : []).filter((e) => e.art === 'kontingent' && (ausgang === undefined || e.ausgang === ausgang));
const antworten = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'kontingentAntwort');
const cmd = (t, c) => t.g.handleMessage(t.cs[0], { t: 'cmd', c: c || 'kontingent.freigeben' });
const gesetzt = (used, limit) => { LLM.resetBudget(); if (limit != null) LLM.setBudgetLimit(limit); if (used) LLM.addUsage(used); };
// eine Anfrage des Lage-Spielleiters / des Abenteuer-Spielleiters; danach abwarten, bis die Antwort abgeholt ist
async function lageFragt(t, m) { const r = m.sl.planErzwingen(); await pumpen(t.g, 4); return r; }
async function abenteuerFragt(t, m) { const r = m.ab.erzwingen(); await pumpen(t.g, 4); return r; }
const gefragt = (m, kind) => m.tr.gefragt.filter((k) => k === kind).length;
const blockNach = (g) => { for (let i = 0; i < 40; i++) { const s = g.snapshot(); if ('kontingent' in s.world) return s.world.kontingent; } return undefined; };

// ---------- Missions-Spielleiter (Kampagne), wie test-spielleiter.js (Pipeline, Rueckfaelle) ----------
function fakeGame() {
  const events = [], errors = [];
  const g = {
    time: 0, C: CONFIG, env: Object.assign({}, LIVE, { REGIE_DIR: REGIE }), players: [{ connected: true }],
    ship: { scene: 'hafen' },
    emit(k, d) { events.push({ k, d }); }, oda() {}, notice() {}, countError(w, e) { errors.push(w + ': ' + (e && e.message)); }, log() {},
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
  return { g, events, errors };
}
async function missionLauf(katalog, ctx, archiv) {
  const F = fakeGame();
  const tr = fakeTransport();
  const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'live', katalog, transport: tr }), kontext: () => ctx, archiv, regieDir: fs.mkdtempSync(path.join(TMP, 'r-')), katalog, config: { offers: 1 } });
  sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
  for (let t = 0; t < 12; t += 0.5) { F.g.time += 0.5; sl.update(0.5); await frei(); if (sl.offers().length >= 2) break; }
  return { sl, tr, F };
}
const missionFunk = (ml) => ml.F.events.filter((e) => e.k === 'radio' && String(e.d.text).startsWith(MELDUNG)).length;

section('Schwelle: 449 999 fragt, 450 000 fragt nicht (alle drei Spielleiter), Meldung genau einmal', async () => {
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
  ok(funk(t).length === 0 && logs(t.g).length === 0, 'noch keine Meldung');
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
  ok(funk(t).length === 1 && funk(t2).length === 1, 'Funk „Kontingent aufgebraucht“ genau einmal je Spiel trotz vieler Pruefungen und Schritte');
  ok(logs(t.g, 'erreicht').length === 1, 'Regie-Logbuch: ein Eintrag „erreicht“');
  const fk = blockNach(t.g);
  ok(fk && fk.used === 450000 && fk.limit === 500000 && fk.schwelle === 450000 && fk.erreicht === true, 'world.kontingent { used, limit, schwelle, erreicht } mit erreicht wahr');
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
  ok(missionFunk(ml) === 1, 'Missions-Spielleiter-Spiel: Funk genau einmal');
  LLM.resetBudget();
});

section('Freigabe: Limit und Schwelle +500 000, Spielleiter fragen wieder, Meldung erneut bei 950 000', async () => {
  gesetzt(450000);
  const t = neuesSpiel(), m = mitLage(t);
  await pumpen(t.g, 3);
  ok(Kontingent.erreicht() && funk(t).length === 1, 'Ausgangslage: erreicht, eine Meldung');
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
  ok(!Kontingent.erreicht() && funk(t).length === 1, '949 999: nicht erreicht, keine neue Meldung');
  ok((await lageFragt(t, m)).gestartet, '949 999: Lage fragt');
  LLM.addUsage(1);   // 950 000
  await pumpen(t.g, 5);
  ok(Kontingent.erreicht() && funk(t).length === 2 && logs(t.g, 'erreicht').length === 2, '950 000: Meldung erneut (zwei insgesamt), zweiter Logbuch-Eintrag');
  const vor = gefragt(m, 'lage');
  const r2 = await lageFragt(t, m);
  ok(!r2.gestartet && gefragt(m, 'lage') === vor, '950 000: Lage-Spielleiter fragt nicht mehr');
  await pumpen(t.g, 30);
  ok(funk(t).length === 2, 'weitere Schritte melden nicht noch einmal');
  LLM.resetBudget();
});

section('Rechte: nur Captain, Doppeldruck erhoeht nicht doppelt', async () => {
  gesetzt(450000);
  const t = X.spiel({ names: ['ZEBRAKAI', 'Mireille_Kas', 'Ouzo_Brandt'], crew: 3, env: LIVE });
  const rollen = ['helm', 'weapons', 'technik'];
  t.g.players.forEach((p, i) => { p.zone = 'ship'; p.console = rollen[i]; });
  await pumpen(t.g, 3);
  t.cs.forEach((c) => t.g.handleMessage(c, { t: 'cmd', c: 'kontingent.freigeben' }));
  ok(LLM.budget().limit === 500000 && Kontingent.schwelle() === 450000, 'Helm, Ops, Technik: keine Freigabe (Limit und Schwelle unveraendert)');
  ok(t.cs.every((c) => c.inbox.some((m) => m.t === 'event' && m.kind === 'notice' && /passenden Konsole/.test(m.text))), 'jede andere Rolle bekommt die bestehende Absage');
  ok(logs(t.g, 'freigabe').length === 0, 'keine Freigabe im Logbuch');
  t.g.players[0].console = null;
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
  ok(LLM.budget().limit === 500000, 'ohne Konsole: nichts');
  t.g.players[0].console = 'captain';
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
  const a = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'kontingentAntwort');
  ok(LLM.budget().limit === 1000000 && Kontingent.schwelle() === 950000, 'Captain, zweimal gedrueckt: genau +500 000');
  ok(a.length === 2 && a[0].ok === true && a[1].ok === false && a[1].code === 'nicht_erreicht' && typeof a[1].text === 'string', 'erste Antwort ok, zweite nicht_erreicht mit Text');
  ok(logs(t.g, 'freigabe').length === 1, 'genau eine Freigabe im Logbuch');
  // nicht erreicht: auch der Captain bewirkt nichts
  gesetzt(1000);
  const t2 = neuesSpiel();
  t2.g.handleMessage(t2.cs[0], { t: 'cmd', c: 'kontingent.freigeben' });
  ok(LLM.budget().limit === 500000 && antworten(t2)[0].code === 'nicht_erreicht', 'vor dem Erreichen: nicht_erreicht, Limit bleibt');
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
  ok(r.gestartet && funk(t).length === 0, '53 999: fragt, keine Meldung');
  LLM.addUsage(1);   // 54 000
  await pumpen(t.g, 3);
  r = await lageFragt(t, m);
  ok(!r.gestartet && funk(t).length === 1, '54 000: gesperrt, Meldung kommt');
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

// ---------- M4: neue Verbindung, Wiederverbinden, Uebernahme, Neustart bei erreichtem Kontingent: der Block kommt (erneut) an ----------
section('Verbindungen: erreicht, dann Wiederverbinden / Beitritt / Uebernahme / Neustart -> Block kommt erneut', async () => {
  const bloecke = (c) => c.inbox.filter((m) => m.t === 'snap' && m.world && m.world.kontingent).map((m) => m.world.kontingent);
  const neu = () => ({ inbox: [], send(m) { if (this.inbox.length < 2000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } });
  const pump = async (g, k) => { for (let i = 0; i < k; i++) { g.step(); if (g.wantsSnapshot()) g.broadcast(g.snapshot()); await frei(); } };   // wie server/index.js: Schritt, dann alle snapEvery Ticks ein Snapshot an alle Verbindungen
  gesetzt(450000);
  const t = X.spiel({ names: ['ZEBRAKAI', 'Mireille_Kas', 'Ouzo_Brandt'], crew: 3, env: LIVE });
  const g = t.g;
  g.players.forEach((p) => { p.zone = 'ship'; });
  await pump(g, 40);
  ok(t.cs.every((c) => bloecke(c).length >= 1 && bloecke(c).every((b) => b.erreicht === true)), 'Ausgangslage: alle drei Verbindungen bekamen den Block (erreicht)');
  // (1) Wiederverbinden: gleiche clientId, neue Verbindung
  const c0 = neu(); g.addConnection(c0); g.handleMessage(c0, { t: 'hello', clientId: 'A0', name: 'ZEBRAKAI', color: 0 });
  await pump(g, 40);
  ok(bloecke(c0).length === 1 && bloecke(c0)[0].erreicht === true && bloecke(c0)[0].used === 450000, `Wiederverbinden: die neue Verbindung bekommt den Block erneut (${bloecke(c0).length})`);
  // (2) Beitritt eines neuen Spielers (vierter Platz, Spiel laeuft)
  const c3 = neu(); g.addConnection(c3); g.handleMessage(c3, { t: 'hello', clientId: 'NEU1', name: 'Tzvi_Lund', color: 3 });
  await pump(g, 40);
  ok(g.players.length === 4 && bloecke(c3).length === 1 && bloecke(c3)[0].erreicht === true, `Beitritt: der neue Spieler bekommt den Block (${bloecke(c3).length})`);
  // (3) Uebernahme: Server voll, ein Platz getrennt, ein Fremder nimmt ihn
  const weg = t.cs[1]; g.removeConnection(weg);
  await pump(g, 10);
  const c4 = neu(); g.addConnection(c4); g.handleMessage(c4, { t: 'hello', clientId: 'NEU2', name: 'Fremder', color: 2 });
  await pump(g, 40);
  ok(g.players.length === 4 && g.players.some((p) => p.clientId === 'NEU2' && p.connected) && bloecke(c4).length === 1, `Uebernahme eines freien Platzes: der Uebernehmer bekommt den Block (${bloecke(c4).length})`);
  // (4) Neustart der Partie (reset in startGame): der Block wird allen erneut geschickt
  t.cs.forEach((c) => { c.inbox.length = 0; }); c0.inbox.length = 0; c3.inbox.length = 0; c4.inbox.length = 0;
  g.reset();
  g.handleMessage(c0, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const p of g.players) if (p.conn) g.handleMessage(p.conn, { t: 'ready', ready: true });
  await pump(g, 60);
  ok(g.phase === 'play' && bloecke(c0).length >= 1 && bloecke(c0).every((b) => b.erreicht === true), `Neustart: die Verbindung bekommt den Block nach dem Neustart erneut (${bloecke(c0).length})`);
  LLM.resetBudget();
});

// ---------- N8: Snapshot-Budget des Feldes world.kontingent im echten Delta-Snapshot (Vertrag: CONTRACT-LIV01.md "Snapshot-Budget")
section('Snapshot-Budget: world.kontingent im echten Delta-Snapshot', async () => {
  const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
  const ORBIT_MAX = 13327, ZIEL = CONFIG.net.snapMax - CONFIG.net.snapLuft;   // Worst Case von npm run snap:mess (Orbitschlacht) und das Ziel
  ok(ZIEL === 18944, 'Ziel snapMax - snapLuft = 18 944 B (' + ZIEL + ')');
  let groesst = 0;
  for (const [used, limit] of [[0, 500000], [450000, 500000], [9999999, 9999999]]) {   // kurz, typisch, die breitesten Zahlen
    gesetzt(used, limit);
    const t = neuesSpiel();
    let s = null; for (let i = 0; i < 30 && !s; i++) { const x = t.g.snapshot(); if ('kontingent' in x.world) s = x; }
    ok(!!s, 'Block im Delta-Snapshot (' + used + ' von ' + limit + ')');
    if (!s) continue;
    const mit = bytes(s); const feld = s.world.kontingent; delete s.world.kontingent;
    const diff = mit - bytes(s);
    groesst = Math.max(groesst, diff);
    ok(diff <= 100, 'Feld kostet ' + diff + ' B im echten Snapshot (JSON ' + bytes(feld) + ' B plus Schluessel), hoechstens 100 B');
  }
  ok(ORBIT_MAX + groesst <= ZIEL, 'Worst Case Orbitschlacht ' + ORBIT_MAX + ' B + Feld ' + groesst + ' B = ' + (ORBIT_MAX + groesst) + ' B <= ' + ZIEL + ' B');
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
    ok(!gesehen && Kontingent.snapshotFeld(t.g) === null && Kontingent.schluessel(t.g) === null, `${JSON.stringify(env)}: kein world.kontingent in 60 Snapshots, obwohl der Zaehler ueber der Schwelle liegt`);
    ok(funk(t).length === 0, `${JSON.stringify(env)}: keine Funk-Meldung`);
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

section('Live-Snapshot: nur bei Aenderung, Funk im Mitschnitt', async () => {
  gesetzt(100);
  const t = neuesSpiel(), g = t.g;
  const felder = () => { const l = []; for (let i = 0; i < 30; i++) { const s = g.snapshot(); if ('kontingent' in s.world) l.push(s.world.kontingent); } return l; };
  const l1 = felder();
  ok(l1.length === 1 && l1[0].erreicht === false && l1[0].limit === 500000 && l1[0].schwelle === 450000, 'Live: ein Block bei der ersten Aenderung, erreicht falsch');
  ok(felder().length === 0, 'unveraendert: nicht erneut gesendet');
  LLM.addUsage(450000);
  const l2 = felder();
  ok(l2.length === 1 && l2[0].erreicht === true, 'nach dem Erreichen: Block mit erreicht wahr');
  // Mitschnitt (MIT-01): die Meldung geht ueber Game.emit('radio') an den Beobachter (Art funk)
  const gesehen = [];
  g.mitschnitt = { vonEmit: (k, d) => { if (k === 'radio') gesehen.push(d); }, taetigkeit() {} };
  gesetzt(0); await pumpen(g, 2); LLM.addUsage(450000); await pumpen(g, 3);
  ok(gesehen.filter((d) => String(d.text).startsWith(MELDUNG)).length === 1, 'Mitschnitt-Beobachter (vonEmit radio) sieht die Meldung einmal');
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
