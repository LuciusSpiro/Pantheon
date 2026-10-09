'use strict';
// BASIS AB WELLE 1 (CONTRACT-W1 §4, AP2 Sprung im Tutorial): tools/fixtures/golden/base-w1 – seit der Anflugpflicht in
// m1–m3 ist `base-w1` die Vergleichsbasis, nicht mehr `base`. Erlaubte Abweichungen base -> base-w1: allow-w1.json.
//   node tools/golden-trace.js --compare tools/fixtures/golden/base-w1 <neu>
//
// Golden Trace (CONTRACT-S1 §9): zeichnet auf, wie sich m1–m3 mit den sim-headless-Bots abspielen, damit nach dem
// Umbau der Missions-Engine gemessen werden kann, ob sich das Tutorial „genau wie heute“ spielt.
//
// Der Trace stützt sich NUR auf öffentliche Ereignisse und Zustände, die den Umbau überleben:
//   game.emit-Ereignisse (stage, missionStart, missionDone, radio, oda, ending, notice an Spieler),
//   game.mission.state.stage / Flags, Inventar und Marken. Kein Zugriff auf DEFS/HOOKS/CHECKS/MISSION_ORDER.
//
// Aufrufe:
//   node tools/golden-trace.js --mission m1|m2|m3 --crew 1|3 --seed N [--out datei.json]
//   node tools/golden-trace.js --all [--seeds 20] [--seed-base 1] [--dir tools/fixtures/golden/base] [--jobs 4]
//   node tools/golden-trace.js --summary <dir>       (Tabelle Median/Min/Max je Mission × Crew)
//   node tools/golden-trace.js --compare <dirA> <dirB> [--allow allow.json] [--tol 15] [--step-tol 1] [--strict-steps] [--lenient]
//     (nicht erlaubte Text-/Flag-/Inventar-Abweichungen sind rot; --lenient berichtet sie nur)
//
// Wie die Missionen gestartet werden:
//   m1, m2: Kampagne ab Lobby (Start „m1“), Bots wie `npm run sim` (sim-headless `Agent`, gleiche Entscheidungen je
//           Crewgröße). Ein Lauf bis „m2 erledigt“; der m1-Trace ist der Teil bis missionDone m1, der m2-Trace der Teil
//           ab missionStart m2 (m2 hängt von den m1-Entscheidungen ab – ein Einzelstart per Debug wäre nicht vergleichbar).
//   m3:     Lobby-Direktstart „m3“ (wie `npm run sim` m3). Crew 3: sim-headless `KeshAgent` (Captain oben, 2 unten).
//           Crew 1: eigener Solo-Bot (unten, auf KeshAgent aufgebaut), Archivschlüssel nacheinander (Solo-Zeitfenster).
//
// Allow-Liste für --compare (gewollte Abweichungen), JSON:
//   { "stages":   ["m1/nachhut", "m3/*"],          // Schritt-IDs, die in Folge/Zeit ignoriert werden ("<mission>/<schritt>")
//     "texts":    ["Tafel", "^Tesk:"],             // Regex auf Funk-/ODA-/Notice-Text ("<von>: <text>" bei Funk)
//     "flags":    ["m3Direct"],                    // Flag-Namen am Ende
//     "inventory":["tafel"],                       // Inventar-Schlüssel am Ende (auch "marks")
//     "duration": ["m3/1"] }                       // Median-Prüfung für <mission>/<crew> nur berichten, nicht werten
//
// Die Bots kommen aus tools/sim-headless.js (Quelltext wird ohne den Hauptteil geladen; sim-headless selbst bleibt
// unverändert). Ausgabe der Basis: tools/fixtures/golden/base/<mission>-c<crew>-s<seed>.json

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { fork } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const SOFTLOCK_SEC = 420;
const MAX_GAME_SEC = 3600;
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- sim-headless laden (ohne Hauptteil) ----------
function loadSim() {
  const file = path.join(__dirname, 'sim-headless.js');
  let src = fs.readFileSync(file, 'utf8');
  const cut = src.lastIndexOf('\n(async () => {');
  if (cut < 0) throw new Error('sim-headless.js: Hauptteil „(async () => {“ nicht gefunden');
  src = src.slice(0, cut) + '\n;module.exports = { Agent, KeshAgent, setSimRng: (r) => { simRng = r; },\n' +
    '  DT, TILE, KESH: typeof KESH !== "undefined" ? KESH : null, KESH_GOALS: typeof KESH_GOALS !== "undefined" ? KESH_GOALS : null,\n' +
    '  onShipPad: typeof onShipPad !== "undefined" ? onShipPad : null, dist };\n';
  const argv = process.argv;
  process.argv = [argv[0], file];   // sim-headless liest Optionen beim Laden aus argv – keine durchreichen
  try {
    const m = new Module(file, module);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    return m.exports;
  } finally { process.argv = argv; }
}

// ---------- Ein Lauf ----------
// kind 'campaign' (m1 -> m2) oder 'm3' (Lobby-Direktstart). Liefert { traces: { m1?, m2?, m3? }, info }.
async function runOne(kind, crew, seed, stopAfter) {
  const Sim = loadSim();
  const CONFIG = require(path.join(ROOT, 'shared/config.js'));
  const { Game } = require(path.join(ROOT, 'server/game.js'));
  const { makeRng } = require(path.join(ROOT, 'server/util.js'));
  const Maps = require(path.join(ROOT, 'shared/maps.js'));
  const Physics = require(path.join(ROOT, 'shared/physics.js'));

  const game = new Game({ noStore: true, seed, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
  let agents;
  if (kind === 'campaign') {
    Sim.setSimRng(makeRng(seed * 7919 + crew));   // wie sim-headless runScenario
    const roles = crew === 1 ? ['solo'] : ['captain', 'helm', 'weapons'].slice(0, crew);
    // gleiche Entscheidungen wie `npm run sim` (sim-headless, Hauptteil)
    const opts = crew === 1 ? { seed, grauzahn: 'fight', decision: 'deliver', sela: 'search', parley: 'bluff', pilot: 'maneuver' }
      : { seed, grauzahn: 'bribe', decision: 'decode', sela: 'buy', parley: 'bluff', pilot: 'maneuver' };
    agents = roles.map((r, i) => new Sim.Agent(game, i, r, opts));
  } else {
    Sim.setSimRng(makeRng(seed * 7919 + 33));   // wie sim-headless runKesh
    if (crew === 1) {
      const SoloKesh = makeSoloKesh(Sim, Maps, Physics);
      agents = [new SoloKesh(game, 0, 'solo', { seed })];
    } else agents = ['captain', 'helm', 'weapons'].slice(0, crew).map((r, i) => new Sim.KeshAgent(game, i, r, { seed }));
  }
  game.simAgents = agents;

  // ---- Aufzeichnung (nur öffentliche Ereignisse) ----
  const T = () => game.time;
  const traces = {};
  let cur = null;          // aktive Mission (aus missionStart)
  const doneThisTick = []; // missionDone in diesem Tick -> Endzustand nach dem Tick erfassen
  const all = { stages: [], radio: [], oda: [], notices: [], ending: null };
  const tr = (id) => traces[id] || (traces[id] = { mission: id, crew, seed, start: null, end: null, durationS: null, stages: [], radio: [], oda: [], notices: [], rewards: [], end_: null });
  const rel = (id) => r1(T() - (traces[id] && traces[id].start != null ? traces[id].start : 0));
  const onEvent = (o) => {
    if (!o || o.t !== 'event') return;
    if (o.kind === 'missionStart') { cur = o.id; tr(o.id).start = T(); }
    else if (o.kind === 'missionDone') { const t = tr(o.id); t.end = T(); t.durationS = r1(t.end - (t.start || 0)); doneThisTick.push(o.id); if (cur === o.id) cur = null; }
    else if (o.kind === 'stage') { const id = o.mission || cur; all.stages.push({ t: r1(T()), mission: id, stage: o.stage }); if (id) tr(id).stages.push({ t: rel(id), mission: id, stage: o.stage }); }
    else if (o.kind === 'radio') { all.radio.push({ t: r1(T()), from: o.from, text: o.text }); if (cur) tr(cur).radio.push({ t: rel(cur), from: o.from, text: o.text }); }
    else if (o.kind === 'oda') { all.oda.push({ t: r1(T()), text: o.text }); if (cur) tr(cur).oda.push({ t: rel(cur), text: o.text }); }
    else if (o.kind === 'ending') { all.ending = { t: r1(T()), title: o.title || null }; }
  };
  const watcher = { send: onEvent };
  game.addConnection(watcher); watcher.observer = true;
  // Notices gehen nur an einzelne Spieler -> an den Bot-Verbindungen mithören (je Text nur das erste Auftreten je Mission)
  const seenNotice = new Set();
  for (const a of agents) {
    const orig = a.conn.send;
    a.conn.send = (o) => {
      if (o && o.t === 'event' && o.kind === 'notice' && cur) {
        const key = cur + '|' + o.text;
        if (!seenNotice.has(key)) { seenNotice.add(key); tr(cur).notices.push({ t: rel(cur), text: o.text }); }
      }
      return orig(o);
    };
  }
  if (kind === 'm3') game.lobbyOpts.startMission = 'm3';
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }

  const flagsOf = () => { const m = game.mission; return JSON.parse(JSON.stringify((m && (m.flags || (m.state && m.state.flags))) || {})); };
  const endState = () => ({ flags: flagsOf(), marks: game.inventory.marks, inventory: JSON.parse(JSON.stringify(game.inventory)) });
  let S = game.snapshot();
  let stage = null, stageStart = 0, softlock = null, ticks = 0;
  let lastMarks = game.inventory.marks;
  const finished = () => {
    if (game.phase === 'end') return true;
    if (stopAfter && traces[stopAfter] && traces[stopAfter].end != null) return true;
    return false;
  };
  while (!finished() && game.time < MAX_GAME_SEC) {
    game.step(); ticks++;
    if (game.wantsSnapshot()) S = game.snapshot();
    for (const a of agents) a.update(S);
    if (game.inventory.marks !== lastMarks) {
      if (cur || doneThisTick.length) { const id = cur || doneThisTick[doneThisTick.length - 1]; tr(id).rewards.push({ t: rel(id), marks: game.inventory.marks, delta: game.inventory.marks - lastMarks }); }
      lastMarks = game.inventory.marks;
    }
    while (doneThisTick.length) tr(doneThisTick.shift()).end_ = endState();
    const key = (game.mission && game.mission.state && game.mission.state.stage) || 'free';
    if (key !== stage) { stage = key; stageStart = game.time; }
    if (game.time - stageStart > SOFTLOCK_SEC) { softlock = (cur || '-') + '/' + stage; break; }
    if (ticks % 3000 === 0) await new Promise((r) => setImmediate(r));
  }
  const out = {};
  for (const id of Object.keys(traces)) {
    const t = traces[id];
    const ok = t.end != null;
    out[id] = {
      format: 'golden-trace/1', mission: id, crew, seed, start: kind === 'm3' ? 'lobby-m3' : 'kampagne',
      success: ok, softlock: ok ? null : softlock, stageAtEnd: ok ? null : (game.mission.state && game.mission.state.stage) || null,
      durationS: ok ? t.durationS : (t.start != null ? r1(game.time - t.start) : null),
      stages: t.stages, radio: t.radio, oda: t.oda, notices: t.notices, rewards: t.rewards,
      end: t.end_ || endState(),
      errors: game.errors,
    };
  }
  if (kind === 'm3' && out.m3 && all.ending) out.m3.ending = all.ending;
  return { traces: out, info: { kind, crew, seed, ticks, gameTime: r1(game.time), softlock, errors: game.errors, phase: game.phase } };
}

// Solo-Bot für m3: an Bord alles selbst (Funk, Kurs, Steuer, Pads), unten wie der KeshAgent mit Rolle „helm“,
// Archivschlüssel nacheinander (Solo-Zeitfenster CONFIG.awayCombat.archkeySoloWindow).
function makeSoloKesh(Sim, Maps, Physics) {
  const { KeshAgent, DT, KESH_GOALS, dist } = Sim;
  return class SoloKeshAgent extends KeshAgent {
    update(S) {
      const p = this.me(S);
      if (!p) return;
      this.updateLocs(S);
      if (this.waitT > 0) { this.waitT -= DT; return; }
      if (S.phase === 'end' || !S.mission.active || S.mission.active.id !== 'm3') return;
      const st = S.mission.stage;
      if (p.zone === 'away') { this.soloAway(S, p, st); return; }
      if (p.downed) { this.input(0, 0); return; }
      this.soloShip(S, p, st);
    }
    soloShip(S, p, st) {
      if (st === 'briefing') { this.acceptRadio(S) || this.enter(S, 'captain'); return; }
      if (st === 'extract' && S.inventory.tafel >= 1) { if (p.console) this.leave(S); this.input(0, 0); return; }
      if (S.ship.scene !== 'kesh') { this.travel(S, p, 'kesh'); return; }   // Rolle solo: Captain wählt, Steuer springt
      const sh = S.ship; const stn = this.station(S);
      const spot = { x: stn.x - 250, y: stn.y };
      const ok = dist(sh.x, sh.y, stn.x, stn.y) <= 330 && sh.speed <= 12;
      if (!ok) { if (this.enter(S, 'helm')) { if (dist(sh.x, sh.y, spot.x, spot.y) > 60) this.steer(S, spot.x, spot.y, 30, 90); else this.brake(S); } return; }
      if (p.console && p.console !== 'transfer') { this.leave(S); return; }   // Agent.send stellt vor dem Verlassen auf STOPP
      if (this.loadoutStep(S, p)) return;   // BOTS W3: Waffenwahl an der Transfer-Konsole (sim-headless KeshAgent)
      if (!this.onMyPad(S, p)) return;
      this.holdBeam(S, p);
    }
    soloAway(S, p, st) {
      if (st === 'archive' && !S.away.vault.open && !p.downed && !this.enemiesInSight(S, p).length) { this.soloKeys(S, p); return; }
      const role = this.role; this.role = 'helm';
      try { this.awayLogic(S, p, st); } finally { this.role = role; }
    }
    soloKeys(S, p) {
      const m = this.memo;
      if (m.soloKey == null) m.soloKey = 0;
      // gedrehter Schlüssel bleibt im Solo-Zeitfenster auf t = 1 -> zum anderen wechseln
      if (S.away.keys[m.soloKey].t >= 1 && S.away.keys[1 - m.soloKey].t < 1) { m.soloKey = 1 - m.soloKey; m.keyHoldFrom = null; this.ix = null; if (this.actDown) this.act(false); }
      const k = m.soloKey;
      const acc = k === 0 ? KESH_GOALS.keyA : KESH_GOALS.keyB;
      const key = S.away.keys[k];
      const t = this.tile(p);
      if (t.x !== acc.x || t.y !== acc.y) { if (this.actDown) this.act(false); this.ix = null; this.goto(S, [acc]); return; }
      if (m.keyHoldFrom == null) m.keyHoldFrom = S.time;
      const r = this.interact(S, key.x, key.y, { hold: true, max: 6, until: (S2) => S2.away.vault.open || S2.away.keys[k].t >= 1 });
      if (process.env.GOLDEN_DEBUG && r !== 'running') console.error(`[solo] t ${S.time.toFixed(1)} key ${k} -> ${r} keys ${JSON.stringify(S.away.keys)} act ${JSON.stringify(p.action)}`);
      if (r === 'done') { m.keyHoldFrom = null; this.game.simStats.keyTries++; }
      else if (r === 'fail') { m.keyHoldFrom = null; this.waitT = 0.4; }
    }
  };
}

// ---------- Dateien ----------
const fileName = (mission, crew, seed) => `${mission}-c${crew}-s${seed}.json`;
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, compactJson(obj) + '\n', 'utf8');
}
// Kompakt, aber diff-freundlich: ein Feld je Zeile, Listen mit einem Eintrag je Zeile
function compactJson(obj) {
  const lines = Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => {
    if (Array.isArray(v) && v.length) return `  ${JSON.stringify(k)}: [\n` + v.map((e) => '    ' + JSON.stringify(e)).join(',\n') + '\n  ]';
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return '{\n' + lines.join(',\n') + '\n}';
}

async function cmdSingle() {
  const mission = val('--mission', 'm1');
  const crew = Number(val('--crew', '1'));
  const seed = Number(val('--seed', '1'));
  if (!['m1', 'm2', 'm3'].includes(mission) || ![1, 2, 3].includes(crew) || !Number.isFinite(seed)) { console.error('Aufruf: --mission m1|m2|m3 --crew 1|3 --seed N'); process.exit(2); }
  const kind = mission === 'm3' ? 'm3' : 'campaign';
  const dir = val('--dir', null);
  // --both: Kampagne bis m2 und beide Traces schreiben (Sammelmodus)
  const both = has('--both') && kind === 'campaign';
  const res = await runOne(kind, crew, seed, both ? 'm2' : mission);
  const want = both ? ['m1', 'm2'] : [mission];
  for (const id of want) {
    const tr = res.traces[id] || { format: 'golden-trace/1', mission: id, crew, seed, success: false, softlock: res.info.softlock, durationS: null, stages: [], radio: [], oda: [], notices: [], rewards: [], end: null };
    const out = dir ? path.join(dir, fileName(id, crew, seed)) : (val('--out', null) || null);
    if (out) writeJson(out, tr); else console.log(JSON.stringify(tr, null, 1));
    console.error(`[golden] ${id} crew ${crew} seed ${seed}: ${tr.success ? 'ok' : 'NICHT erledigt' + (tr.softlock ? ' (Softlock ' + tr.softlock + ')' : '')}, ${tr.durationS} s, ${tr.stages.length} Schritte${out ? ' -> ' + out : ''}`);
  }
}

async function cmdAll() {
  const seeds = Number(val('--seeds', '20'));   // Basis wurde mit 20 Seeds (1–20) erzeugt
  const base = Number(val('--seed-base', '1'));
  const dir = path.resolve(val('--dir', path.join(ROOT, 'tools/fixtures/golden/base')));
  const jobs = Math.max(1, Number(val('--jobs', '4')));
  const crews = (val('--crews', '1,3')).split(',').map(Number);
  const missions = (val('--missions', 'campaign,m3')).split(',');
  const queue = [];
  for (const crew of crews) for (let s = base; s < base + seeds; s++) {
    if (missions.includes('campaign')) queue.push(['--mission', 'm2', '--both', '--crew', String(crew), '--seed', String(s), '--dir', dir]);
    if (missions.includes('m3')) queue.push(['--mission', 'm3', '--crew', String(crew), '--seed', String(s), '--dir', dir]);
  }
  const t0 = Date.now();
  let failed = 0;
  await new Promise((resolve) => {
    let running = 0;
    const next = () => {
      if (!queue.length && !running) return resolve();
      while (running < jobs && queue.length) {
        const a = queue.shift(); running++;
        const ch = fork(__filename, a, { stdio: 'inherit' });
        ch.on('exit', (code) => { if (code) failed++; running--; next(); });
      }
    };
    next();
  });
  console.log(`[golden] fertig in ${Math.round((Date.now() - t0) / 1000)} s, ${failed} Prozessfehler -> ${dir}`);
  summarize(dir);
}

// ---------- Auswertung / Vergleich ----------
function loadDir(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!/^m\d+-c\d+-s-?\d+\.json$/.test(f)) continue;
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out[`${t.mission}/${t.crew}/${t.seed}`] = t;
  }
  return out;
}
const median = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : r1((a[m - 1] + a[m]) / 2); };
function groups(set) {
  const g = {};
  for (const t of Object.values(set)) (g[`${t.mission}/${t.crew}`] = g[`${t.mission}/${t.crew}`] || []).push(t);
  return g;
}
function summarize(dir) {
  const set = loadDir(dir);
  const g = groups(set);
  console.log('\nMission/Crew | Läufe | erledigt | Median s | Min s | Max s | Schrittfolgen');
  for (const k of Object.keys(g).sort()) {
    const ts = g[k]; const d = ts.filter((t) => t.success).map((t) => t.durationS);
    const seqs = new Set(ts.map((t) => t.stages.map((s) => s.stage).join('>')));
    console.log(`${k.padEnd(12)} | ${String(ts.length).padStart(5)} | ${String(d.length).padStart(8)} | ${String(median(d)).padStart(8)} | ${String(d.length ? Math.min(...d) : '-').padStart(5)} | ${String(d.length ? Math.max(...d) : '-').padStart(5)} | ${seqs.size}`);
  }
}

function cmdCompare() {
  const i = args.indexOf('--compare');
  const dirA = args[i + 1], dirB = args[i + 2];
  if (!dirA || !dirB) { console.error('Aufruf: --compare <dirA> <dirB> [--allow datei.json]'); process.exit(2); }
  const tol = Number(val('--tol', '15'));
  const stepTol = Number(val('--step-tol', '1'));
  const strictSteps = has('--strict-steps');
  const lenient = has('--lenient');
  const allowFile = val('--allow', null);
  const allow = Object.assign({ stages: [], texts: [], flags: [], inventory: [], duration: [] }, allowFile ? JSON.parse(fs.readFileSync(allowFile, 'utf8')) : {});
  const stageAllowed = (mission, stage) => allow.stages.some((p) => p === `${mission}/${stage}` || p === `${mission}/*`);
  const textRes = allow.texts.map((s) => new RegExp(s));
  const textAllowed = (s) => textRes.some((re) => re.test(s));
  const A = loadDir(dirA), B = loadDir(dirB);
  let red = 0; const warn = [];
  const line = (s) => console.log(s);
  line(`Golden-Trace-Vergleich: A = ${dirA}  B = ${dirB}${allowFile ? '  (Allow: ' + allowFile + ')' : ''}`);
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  let identical = 0;
  for (const k of keys) {
    const a = A[k], b = B[k];
    if (!a || !b) { line(`  ${k}: fehlt in ${a ? 'B' : 'A'}`); red++; continue; }
    const strip = (t) => JSON.stringify(Object.assign({}, t, { errors: undefined }));
    if (strip(a) === strip(b)) { identical++; continue; }
    const sa = a.stages.filter((s) => !stageAllowed(s.mission, s.stage)), sb = b.stages.filter((s) => !stageAllowed(s.mission, s.stage));
    const qa = sa.map((s) => s.stage).join('>'), qb = sb.map((s) => s.stage).join('>');
    const msgs = [];
    // Basis-Lauf blieb hängen (Bot-Schwäche, z. B. m1 solo Seed 8): kein Rot, wenn B weiterkommt; Folge nur als Präfix prüfen
    if (a.success && !b.success) { msgs.push(`Erfolg true -> false${b.softlock ? ' (Softlock ' + b.softlock + ')' : ''}`); red++; }
    else if (!a.success && b.success) msgs.push(`Hinweis: Basis blieb hängen (${a.softlock || a.stageAtEnd}), B erledigt`);
    const prefixOnly = !a.success || !b.success;
    const seqOk = prefixOnly ? (qa.startsWith(qb) || qb.startsWith(qa)) : qa === qb;
    if (!seqOk) { msgs.push(`Schrittfolge anders:\n      A ${qa}\n      B ${qb}`); red++; }
    else if (qa !== qb) msgs.push('Schrittfolge nur als Präfix vergleichbar (ein Lauf unvollständig)');
    else {
      const diffs = sa.map((s, j) => ({ stage: s.stage, d: r1(sb[j].t - s.t) }));
      const big = diffs.filter((x) => Math.abs(x.d) > stepTol);
      if (big.length) { const s = `Schrittzeiten > ±${stepTol} s: ` + big.map((x) => `${x.stage} ${x.d > 0 ? '+' : ''}${x.d}`).join(', '); msgs.push(s); if (strictSteps) red++; }
    }
    // Texte (Funk/ODA) als Menge, ohne Zeit
    const texts = (t) => new Set([...t.radio.map((r) => r.from + ': ' + r.text), ...t.oda.map((o) => o.text)].filter((s) => !textAllowed(s)));
    const ta = texts(a), tb = texts(b);
    const gone = [...ta].filter((s) => !tb.has(s)), added = [...tb].filter((s) => !ta.has(s));
    // S1-QA: nicht erlaubte Abweichungen bei Texten, Flags und Inventar zählen als Befund (früher nur berichtet);
    // --lenient stellt das alte Verhalten wieder her
    if (gone.length || added.length) { msgs.push(`Texte: ${gone.length} fehlen, ${added.length} neu` + gone.slice(0, 3).map((s) => `\n      - ${s}`).join('') + added.slice(0, 3).map((s) => `\n      + ${s}`).join('')); if (!lenient) red++; }
    // Endzustand
    if (a.end && b.end) {
      const fk = [...new Set([...Object.keys(a.end.flags || {}), ...Object.keys(b.end.flags || {})])].filter((f) => !allow.flags.includes(f));
      const fd = fk.filter((f) => JSON.stringify(a.end.flags[f]) !== JSON.stringify(b.end.flags[f]));
      if (fd.length) { msgs.push('Flags anders: ' + fd.map((f) => `${f} ${JSON.stringify(a.end.flags[f])}->${JSON.stringify(b.end.flags[f])}`).join(', ')); if (!lenient) red++; }
      const ik = [...new Set([...Object.keys(a.end.inventory || {}), ...Object.keys(b.end.inventory || {})])].filter((x) => !allow.inventory.includes(x));
      const id = ik.filter((x) => JSON.stringify(a.end.inventory[x]) !== JSON.stringify(b.end.inventory[x]));
      if (id.length) { msgs.push('Inventar anders: ' + id.map((x) => `${x} ${JSON.stringify(a.end.inventory[x])}->${JSON.stringify(b.end.inventory[x])}`).join(', ')); if (!lenient) red++; }
    }
    if (msgs.length) line(`  ${k}:\n    ` + msgs.join('\n    '));
    else line(`  ${k}: gleiche Schrittfolge, Zeiten ±${stepTol} s, nur erlaubte Abweichungen`);
  }
  line(`\n${identical}/${keys.length} Traces byte-identisch (ohne Fehlerzähler).`);
  line('\nMedian Spieldauer je Mission/Crew (nur erledigte Läufe):');
  const gA = groups(A), gB = groups(B);
  for (const g of [...new Set([...Object.keys(gA), ...Object.keys(gB)])].sort()) {
    const mA = median((gA[g] || []).filter((t) => t.success).map((t) => t.durationS));
    const mB = median((gB[g] || []).filter((t) => t.success).map((t) => t.durationS));
    const pct = mA && mB != null ? r1((mB - mA) / mA * 100) : null;
    const okD = pct != null && Math.abs(pct) <= tol;
    const allowed = allow.duration.includes(g);
    if (!okD && !allowed) red++;
    line(`  ${g.padEnd(6)} A ${String(mA).padStart(7)} s  B ${String(mB).padStart(7)} s  ${pct == null ? '—' : (pct > 0 ? '+' : '') + pct + ' %'}  ${okD ? 'ok' : allowed ? 'ABWEICHUNG (erlaubt)' : `ROT (Grenze ±${tol} %)`}`);
  }
  for (const w of warn) line(w);
  line(red ? `\nGOLDEN ROT (${red} Befunde)` : '\nGOLDEN GRÜN');
  process.exit(red ? 1 : 0);
}

(async () => {
  if (has('--compare')) return cmdCompare();
  if (has('--summary')) { summarize(path.resolve(val('--summary', '.'))); return; }
  if (has('--all')) return cmdAll();
  return cmdSingle();
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
