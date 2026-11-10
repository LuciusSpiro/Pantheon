'use strict';
// LIV-01 C: dauerhaftes Messwerkzeug des Spielleiters in simulierten Bot-Abenden der Freien Fahrt Sund (aus dem Treiber der Lage-Messung SUND-03a, Erkunder 2026-10-24).
// Faehrt einen Bot (Spruenge, Grenzen: andocken, Absicht waehlen/ablehnen, Szenenende) durch die echte Kette (Game, Lage-Spielleiter, Abenteuer-Komposition, Regie-Pruefung) und legt JEDEN Plan
// (Lage-Plan und Abenteuer-Plan) als eigene Markdown-Datei ab; dazu index.md mit Links, auswertung.md (die vier Befunde vom 2026-10-24 als Zahlen) und messung.json. Ein Produktcode wird nicht geaendert.
//   node tools/messe-lage.js [--mock] [--abend 1,2,3] [--spruenge N] [--plaene N] [--out <ordner>] [--mit-basis] [--ohne-faeden]
//   node tools/messe-lage.js --live ...        echter Claude: nur mit LLM_LIVE=1 UND gefundener CLI, sonst "nicht gemessen" (Exit 0). Das Werkzeug setzt LLM_LIVE nie selbst.
//   node tools/messe-lage.js --auswerten <lauf-ordner>    nur auswerten (auswertung.md neu aus den Dateien eines frueheren Laufs)
// Abende (wie die Treiber): 1 = Seed 7, Stil front, 200 Spruenge; 2 = Seed 23, Stil daheim, 200; 3 = Seed 7, front, 120. Standard: Abend 1. --spruenge ueberschreibt (Selbsttest: 20).
// --plaene: Aufrufe des Lage-Spielleiters je Abend (Standard 6 = Deckel deckel_je_sitzung, hoechstens 12; der Abenteuer-Spielleiter hat seinen eigenen Deckel). Mit --live ist das die Kostenbremse; dazu CLAUDE_TOKEN_BUDGET.
// --mit-basis: faehrt zusaetzlich denselben Abend ohne Spielleiter (Vergleich: erste Abweichung, Ereignisse). --ohne-faeden: FAEDEN nicht setzen (Standard: FAEDEN=1, der Abenteuer-Spielleiter laeuft mit).
// --out: Wurzel der Ablage (relativ zum Aufrufer, NIE im Repo; Standard <Temp>/pantheon-messung). Jeder Lauf bekommt einen neuen Ordner lage-<Zeit>-<modus>; es wird nichts geloescht oder ueberschrieben.
// Umgebung fuer die volle Live-Messung (siehe README "Live-Messung des Spielleiters"): LLM_LIVE=1 CLAUDE_TOKEN_BUDGET=<Deckel>; MITSCHNITT=1 MITSCHNITT_DIR=<ordner> wird an das Spiel durchgereicht.
// Exit 0 (auch bei "nicht gemessen"), 1 Fehler im Lauf, 2 falscher Aufruf.
const fs = require('fs');
const os = require('os');
const path = require('path');
const START_CWD = process.cwd();   // --out und --auswerten sind relativ zum Aufrufer
process.chdir(path.join(__dirname, '..'));
const Ablage = require('./messe-ablage.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const nn = (n) => String(n).padStart(2, '0');
const f = Ablage.fmt, pz = Ablage.prozent;

const ABENDE = {
  1: { nr: 1, seed: 7, stil: 'front', spruenge: 200 },
  2: { nr: 2, seed: 23, stil: 'daheim', spruenge: 200 },
  3: { nr: 3, seed: 7, stil: 'front', spruenge: 120 },
};
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const MAX_PLAENE_STANDARD = 6, MAX_PLAENE_HART = 12;
const ZYKLUS = ['andocken', 'absicht_waehlen', 'szene_ende', 'andocken', 'absicht_ablehnen', 'szene_ende'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const immediate = () => new Promise((r) => setImmediate(r));
const jl = (file, o) => fs.appendFileSync(file, JSON.stringify(o) + '\n');
const lies = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : []);
const zaehle = (a, k) => { const o = {}; for (const x of a) o[x[k]] = (o[x[k]] || 0) + 1; return o; };
const grundArt = (g) => String(g || '').split(/[:(]/)[0].trim().slice(0, 60) || '?';

// ---------- Aufruf pruefen
function aufrufLesen() {
  const fehler = (m) => { console.error(m); process.exit(2); };
  const o = { live: flag('live'), mock: flag('mock'), mitBasis: flag('mit-basis'), faeden: !flag('ohne-faeden') };
  if (o.live && o.mock) fehler('--live und --mock schliessen sich aus');
  const abendArg = wert('abend');
  o.abende = (abendArg === undefined ? '1' : abendArg).split(',').map((x) => Number(x.trim()));
  if (args.includes('--abend') && (abendArg === undefined || abendArg.startsWith('--'))) fehler('--abend: Liste aus 1,2,3');
  if (!o.abende.length || o.abende.some((n) => !ABENDE[n]) || new Set(o.abende).size !== o.abende.length) fehler(`--abend: Liste aus ${Object.keys(ABENDE).join(',')} (jeder Abend hoechstens einmal)`);
  const sp = wert('spruenge'); o.spruenge = sp === undefined ? null : Number(sp);
  if (o.spruenge !== null && !(Number.isInteger(o.spruenge) && o.spruenge >= 1 && o.spruenge <= 1000)) fehler('--spruenge: ganze Zahl 1 bis 1000');
  const pl = wert('plaene'); o.plaene = pl === undefined ? MAX_PLAENE_STANDARD : Number(pl);
  if (!(Number.isInteger(o.plaene) && o.plaene >= 1 && o.plaene <= MAX_PLAENE_HART)) fehler(`--plaene: ganze Zahl 1 bis ${MAX_PLAENE_HART} (harte Obergrenze, Claude kostet Geld)`);
  o.auswerten = wert('auswerten');
  if (args.includes('--auswerten') && (o.auswerten === undefined || o.auswerten.startsWith('--'))) fehler('--auswerten braucht den Ordner eines Laufs');
  if (args.includes('--out')) {
    const a = wert('out');
    try { o.wurzel = Ablage.wurzelPruefen(a && !a.startsWith('--') ? a : '', START_CWD); } catch (e) { fehler(e.message); }
  } else o.wurzel = path.join(os.tmpdir(), 'pantheon-messung');
  if (!o.auswerten) { try { Ablage.wurzelPruefen(o.wurzel, START_CWD); } catch (e) { fehler(e.message); } }
  else { try { Ablage.wurzelPruefen(o.auswerten, START_CWD); } catch (e) { fehler(e.message.replace(/^--out /, '--auswerten ')); } }   // auch die Auswertung schreibt in den Ordner: nie im Repo
  return o;
}

// ---------- Prompt lesen (Merkmale fuer Befund 2 und 3)
function promptMerkmale(prompt) {
  const m = { befehle_frei: false, rate: null, ausschnitt_zeichen: 0, letzte_plaene: 0, letzte_befehle: 0, letzte_abgelehnt: 0, letzte_ok: 0 };
  const t = String(prompt || '');
  const aus = t.match(/<ausschnitt>\n([\s\S]*?)\n<\/ausschnitt>/);
  if (aus) {
    m.ausschnitt_zeichen = aus[1].length;
    try { const a = JSON.parse(aus[1]); if (a.befehle_frei) { m.befehle_frei = true; m.rate = a.befehle_frei.rate != null ? a.befehle_frei.rate : null; } } catch (e) { /* kein JSON: Merkmale bleiben leer */ }
  }
  const lp = t.match(/<letzte_plaene>\n([\s\S]*?)\n<\/letzte_plaene>/);
  if (lp) {
    try {
      const l = JSON.parse(lp[1]);
      if (Array.isArray(l)) for (const p of l) {
        m.letzte_plaene++;
        for (const b of Array.isArray(p.befehle) ? p.befehle : []) { m.letzte_befehle++; if (/abgelehnt/.test(String(b))) m.letzte_abgelehnt++; else if (/: ok\b/.test(String(b))) m.letzte_ok++; }
      }
    } catch (e) { /* ignorieren */ }
  }
  return m;
}

// ---------- ein Abend
async function abend(cfg, o, dir, modus) {
  const basis = modus === 'basis', live = modus === 'live';
  const LLM = require('../server/mission/llm.js');
  const F = require('./regie-fixture.js');
  const Regie = require('../server/sim/regie-befehle.js');
  const LagePrompt = require('../server/sim/lage-prompt.js');
  const Kriegslage = require('../server/sim/kriegslage.js');
  const Sektoren = require('../shared/sektoren.js');
  const Sprung = require('../server/sim/sprung.js');
  const Ruf = require('../server/sim/ruf.js');
  const Absicht = require('../server/sim/absicht.js');
  const Regielog = require('../server/mission/regielog.js');
  fs.mkdirSync(dir);   // ohne recursive und ohne Loeschen: ein vorhandener Ordner ist ein Fehler
  const regieDir = path.join(dir, 'regie');
  const env = basis ? { REISE_EREIGNISSE: '1' } : { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: live ? 'live' : 'mock', REISE_EREIGNISSE: '1' };
  if (!basis && o.faeden) env.FAEDEN = '1';
  // Live: der Lage-Spielleiter liest den Schalter aus dem env des Spiels (modusAusEnv: live nur mit LLM_LIVE=1 dort); das Werkzeug reicht die Umgebung des Aufrufers durch, setzt sie aber nie selbst (LLM_LIVE, Router LLM_*, OLLAMA_*)
  if (live) for (const k of Object.keys(process.env)) if (/^(LLM_|OLLAMA_|CLAUDE_CLI$|FAKE_)/.test(k)) env[k] = process.env[k];
  Object.assign(env, { REGIE_DIR: regieDir, MISSION_SOURCE: 'fallback' });
  for (const k of ['MITSCHNITT', 'MITSCHNITT_DIR']) if (process.env[k] !== undefined) env[k] = process.env[k];
  const budget0 = LLM.budget();
  const spruenge = o.spruenge || cfg.spruenge;
  const t = F.neuesSpiel({ crew: 3, seed: cfg.seed, names: NAMEN, env });
  const g = t.g, cs0 = t.cs[0];
  Ruf.aendern(g, 'rom', 60);   // Rang Tribun (Voraussetzung fuer Strategische Optionen; im Spiel erspielt die Crew ihn)
  const ws = g.weltsim;
  const log = (n) => path.join(dir, n);

  // Hilfen am Spiel: nur umhuellt (Instanz), nie veraendert; alles wird im finally zurueckgesetzt
  const pa0 = Regie.planAnwenden;
  let aktuell = null;   // der Plan, der gerade im Lage-Spielleiter ankommt (antwort() ruft planAnwenden synchron)
  const regieErgebnisse = new Map();   // nr -> res
  Regie.planAnwenden = function (game, plan) {
    const tick = game.weltsim.tickZahl;
    const res = pa0.call(this, game, plan);
    const kurzRes = { ok: res.ok, grund: res.grund || null, angenommen: res.angenommen.map((a) => ({ typ: a.befehl && a.befehl.typ, ziel: a.befehl && (a.befehl.fraktion || a.befehl.gegen || a.befehl.ort || a.befehl.an || a.befehl.hex || null), ab: a.ab, vorwarnung: !!a.vorwarnung, platz: !!a.platz })), abgelehnt: res.abgelehnt.map((a) => ({ typ: a.befehl && a.befehl.typ, grund: String(a.grund) })), funk: res.funk };
    if (aktuell != null) regieErgebnisse.set(aktuell, kurzRes);
    jl(log('plaene.jsonl'), { tick, nr: aktuell, plan, res: kurzRes });
    return res;
  };
  let sl = null, abbruch = null;
  const calls = [];   // jede Anfrage: Prompt, Antwort oder Fehler (Zuordnung ueber kind + input.nr, nie ueber einen Index)
  const wrapLlm = () => {
    if (!sl || sl._messeGewrappt) return;
    const llm = sl.getLlm(); sl._messeGewrappt = true;
    const umhuellen = (name) => {
      const a0 = llm[name].bind(llm);
      llm[name] = async (kind, input, opt) => {
        const rec = { seq: calls.length + 1, kind, nr: input && input.nr, grenze: input && input.art, tick: ws.tickZahl, start: new Date().toISOString(), wall0: Date.now(), prompt: input && input.prompt, system: input && input.system, eskaliert: name === 'eskaliere' };
        calls.push(rec);
        try {
          const r = await a0(kind, input, opt);
          Object.assign(rec, { wall_s: (Date.now() - rec.wall0) / 1000, antwort: { text: r.text || '', usage: r.usage, tokens: r.tokens, cost: r.cost, sec: r.sec, key: r.key, cli: r.cli ? r.cli.quelle : null, anbieter: r.anbieter || null, modell: r.modell || r.modelId || null }, tickEnde: ws.tickZahl });
          return r;
        } catch (e) {
          Object.assign(rec, { wall_s: (Date.now() - rec.wall0) / 1000, fehler: (e.code || 'EXIT') + ': ' + String(e.message).slice(0, 300), tickEnde: ws.tickZahl });
          throw e;
        }
      };
    };
    umhuellen('ask'); umhuellen('eskaliere');
    // --plaene deckelt die Aufrufe je Abend (nie ueber die Werte des Spiels hinaus); W ist je Instanz eine Kopie, die Datei der Werte bleibt unberuehrt
    sl.W = Object.assign({}, sl.W, { deckel_je_sitzung: Math.min(sl.W.deckel_je_sitzung, o.plaene) });
    if (sl.abenteuer) sl.abenteuer.W = Object.assign({}, sl.abenteuer.W, { deckel_je_sitzung: Math.min(sl.abenteuer.W.deckel_je_sitzung, o.plaene) });
    const antwort0 = Object.getPrototypeOf(sl).antwort;
    sl.antwort = function (job, r) { aktuell = job.nr; try { return antwort0.call(sl, job, r); } finally { aktuell = null; } };
  };
  // beide Spielleiter (Lage und Abenteuer-Komposition) zaehlen: sonst laeuft das Spiel im Zeitraffer weiter, waehrend ein Aufruf in der Luft ist
  const busy = () => !!sl && (sl.zustand === 'laeuft' || sl.zustand === 'angefragt' || sl.inbox.length > 0
    || (!!sl.abenteuer && (sl.abenteuer.zustand !== 'idle' || sl.abenteuer.inbox.length > 0)));
  let nStep = 0;
  const drain = () => {
    const inbox = cs0.inbox; cs0.inbox = [];
    for (const m of inbox) if (m && m.t === 'event') jl(log('funk.jsonl'), { tick: ws.tickZahl, zeit: Math.round(g.time * 10) / 10, m });
  };
  // Laeuft eine Anfrage, geht die Spielzeit in Echtzeit (30 Hz), sonst im Zeitraffer: das Spiel wartet nie, und die Antwort kommt zwischen den Ticks an wie im Betrieb.
  const stp = async () => {
    g.step(); nStep++;
    if (!sl && g.lageSpielleiter) { sl = g.lageSpielleiter; wrapLlm(); }
    if (nStep % 30 === 0) drain();
    if (busy()) await sleep(live ? 33 : 1); else if (nStep % 20 === 0) await immediate();
  };
  const pruefeAbbruch = () => {
    if (!sl || abbruch || !g.lageRegie) return;
    const fe = g.lageRegie.log.entries.filter((e) => e.art === 'lage_grobplan' && e.ausgang === 'fehler');
    if (fe.length >= 2) {
      const c1 = String((fe[fe.length - 1].fehler || [])[0] || '').split(':')[0], c2 = String((fe[fe.length - 2].fehler || [])[0] || '').split(':')[0];
      if (c1 === c2) abbruch = 'wiederholter Fehler ' + c1;
    }
    if (fe.length && /ENOENT|RATE_LIMIT|REFUSED|OFF/.test(String((fe[fe.length - 1].fehler || [])[0]))) abbruch = 'harter Fehler ' + fe[fe.length - 1].fehler;
  };

  // Bot: eigener Zufallsstrom
  let zs = (cfg.seed * 2654435761) >>> 0;
  const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let x = zs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const place = (x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
  const hexHier = () => Sektoren.hexVonOrt(g.ship.scene);
  const startHex = hexHier();
  const visited = new Set();
  const nahe = (h, max) => { const seen = new Map([[startHex, 0]]); let front = [startHex]; while (front.length) { const nx = []; for (const c of front) for (const n of Sektoren.nachbarn(c)) if (!seen.has(n) && seen.get(c) < max) { seen.set(n, seen.get(c) + 1); nx.push(n); } front = nx; } return seen.has(h); };
  function nachbarn() {
    const von = hexHier(), out = [];
    for (const h of Sektoren.nachbarn(von)) {
      if (!Sektoren.spielbar(h) || !Sektoren.ortVonHex(h) || Sektoren.istLeerraum(h)) continue;
      g.explore.markBoje(Sektoren.kanteId(von, h));
      if (Sprung.hexGrund(g, von, h)) continue;
      if (cfg.stil === 'daheim' && !nahe(h, 2)) continue;
      out.push(h);
    }
    return out;
  }
  async function springe(hex) {
    const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return e;
    const p = Sprung.sprungpunkt(g, hex); if (!p) return 'kein Sprungpunkt';
    place(p.x - 80, p.y);
    for (let k = 0; k < 30 * 30 && !g.ship.jump.ready; k++) { g.space.enemies = []; await stp(); }
    g.space.enemies = [];
    return Sprung.doJump(g);
  }

  // Logbuch je Tick (fuer Vergleich mit der Basis)
  const besitz = () => Object.fromEntries(Object.entries(ws.zustand.hexe).map(([c, h]) => [c, (h.besitzer || '-') + (h.posten ? 'P' : '')]));
  let besitzAlt = besitz(); const chronikGesehen = new Set();
  function tickLog(j, aktion) {
    const z = ws.zustand, jetzt = besitz(), wechsel = [];
    for (const c of Object.keys(jetzt)) if (jetzt[c] !== besitzAlt[c]) wechsel.push(c + ' ' + besitzAlt[c] + '>' + jetzt[c]);
    besitzAlt = jetzt;
    const chron = []; for (const c of ws.chronik || []) { const k = c.t + '|' + c.kurz; if (!chronikGesehen.has(k)) { chronikGesehen.add(k); chron.push(c); } }
    const neu = (ws.ereignisse || []).filter((e) => e.n === ws.tickZahl && e.typ !== 'konvoi');
    const embargo = Object.entries(z.embargo || {}).filter(([, e]) => z.tick < e.bis).map(([k, e]) => k + ':' + e.waren.join('') + ':bis' + e.bis);
    jl(log('ticks.jsonl'), {
      j, tick: ws.tickZahl, hex: hexHier(), aktion, ereignisse: neu, besitzwechsel: wechsel, chronik: chron, embargo,
      mieten: z.flotten.filter((fl) => fl.miete).map((fl) => fl.id + '->' + fl.miete.an), angriffe_aktiv: z.angriffe.filter((a) => a.t_ende === null).length, angriffe_gesamt: z.angriffe.length,
      flotten_aktiv: z.flotten.filter((fl) => fl.befehl !== 'heim').length, regie: { vorgemerkt: (ws.regie.vorgemerkt || []).length, rate: (ws.regie.rate || []).length },
      absichten: z.absichten || null,
    });
  }

  // Grenzen des Bots: Zyklus andocken, Absicht waehlen, Szenenende, andocken, Absicht ablehnen, Szenenende; ausgeloest, sobald kein Aufruf laeuft und der Mindestabstand erreicht ist
  let grenzNr = 0; const grenzen = [];
  const spieler = g.players[0];
  function grenze() {
    const art = ZYKLUS[grenzNr++ % ZYKLUS.length];
    let tat = art;
    const vor = sl.aufrufe;
    if (art === 'andocken') g.missionEvent('docked', { loc: 'x' });
    else if (art === 'szene_ende') Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'szene' });
    else {
      const alt = { console: spieler.console, station: spieler.station };
      spieler.console = 'shop'; spieler.station = null;   // Konsole 'shop' (Station.stationOf(p) === 'shop'), Angebot per Debug sicherstellen, echten Befehl senden
      if (!(ws.absicht && ws.absicht.angebot)) Absicht.debug(g, ['angebot']);
      const an = ws.absicht && ws.absicht.angebot;
      const antwortVor = cs0.inbox.length;
      if (!an) { tat = art + ' (kein Absicht-Angebot verfuegbar, Grenze ohne Wahl)'; }
      else if (art === 'absicht_waehlen') { g.handleMessage(cs0, { t: 'cmd', c: 'absicht.waehlen', id: an.ids[0] }); tat = 'absicht.waehlen ' + an.ids[0] + ' (Angebot ' + an.ids.join('/') + ')'; }
      else { g.handleMessage(cs0, { t: 'cmd', c: 'absicht.ablehnen' }); tat = 'absicht.ablehnen (Angebot ' + an.ids.join('/') + ')'; }
      const antw = cs0.inbox.slice(antwortVor).filter((m) => m && m.kind === 'absichtAntwort');
      jl(log('funk.jsonl'), { tick: ws.tickZahl, grenzantwort: antw });
      if (an) tat += ' -> ' + JSON.stringify(antw.map((m) => ({ ok: m.ok, code: m.code, text: m.text })));
      spieler.console = alt.console; spieler.station = alt.station;
    }
    grenzen.push({ tick: ws.tickZahl, art, tat, aufrufeVorher: vor, geplant: sl.aufrufe > vor, zustand: sl.zustand, uebersprungen: JSON.stringify(sl.zaehler.uebersprungen) });
    return tat;
  }

  // Der Lage-Plan startet an jeder Grenze vor der Abenteuer-Komposition; hat er seinen Deckel erreicht, bekommt die Komposition die weiteren Grenzen (eigener Deckel und Cooldown in Grenzen).
  const lageMax = () => sl.W.deckel_je_sitzung, abMax = () => (o.faeden && sl.abenteuer ? sl.abenteuer.W.deckel_je_sitzung : 0);
  const grenzMax = () => lageMax() + abMax() * ((sl.abenteuer ? sl.abenteuer.W.cooldown_grenzen : 0) + 1) + 2;
  const fertig = () => sl.aufrufe >= lageMax() && (!abMax() || sl.abenteuer.aufrufe >= abMax());
  const t0 = Date.now();
  let sprueng = 0, fehlSpr = 0;
  try {
    await stp(); await stp();
    console.log(`[Abend ${cfg.nr}${basis ? ' Basis' : ''}] ${modus} seed ${cfg.seed} stil ${cfg.stil} start in ${startHex}, ${spruenge} Spruenge`);
    while (sprueng < spruenge && !abbruch) {
      const kand = nachbarn();
      if (!kand.length) { console.log('Sackgasse'); break; }
      const pool = cfg.stil === 'front' ? ((kand.filter((h) => !visited.has(h)).length && zufall() < 0.7) ? kand.filter((h) => !visited.has(h)) : kand) : kand;
      const ziel = pool[Math.floor(zufall() * pool.length)];
      const r = await springe(ziel);
      if (r || hexHier() !== ziel) { fehlSpr++; if (fehlSpr > 5) break; continue; }
      visited.add(ziel); sprueng++;
      let aktion = null;
      if (sl && !busy() && grenzNr < grenzMax() && sprueng >= Math.min(8, Math.floor(spruenge / 3)) && (sl.letzterStartTick == null || ws.tickZahl - sl.letzterStartTick >= 12)) aktion = grenze();
      tickLog(sprueng, aktion);
      drain();
      pruefeAbbruch();
      if (sl && !busy() && fertig()) break;
      if (sprueng % 20 === 0) console.log(`[Abend ${cfg.nr}] Sprung ${sprueng}, Tick ${ws.tickZahl}, Aufrufe ${sl ? sl.aufrufe : 0}, Tokens ${LLM.budget().used}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    // Ausklang: laufende Anfragen beider Spielleiter abwarten (Spielschritte weiter)
    for (let k = 0; k < 130 * 30 && busy(); k++) await stp();
    await stp(); drain();
  } finally {
    Regie.planAnwenden = pa0;
  }
  const z = ws.zustand;
  // vollstaendiges Logbuch aus der Datei unter REGIE_DIR (der Speicher haelt nur 200 Eintraege)
  let logbuch = [];
  if (g.lageRegie && g.lageRegie.log && g.lageRegie.log.file) {
    const wid = path.basename(g.lageRegie.log.file).replace(/\.jsonl$/, '');
    logbuch = Regielog.read(path.dirname(g.lageRegie.log.file), wid).entries;
  }
  if (logbuch.length) fs.writeFileSync(log('logbuch.jsonl'), logbuch.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(log('chronik-ende.json'), JSON.stringify(ws.chronik, null, 1));
  const budget1 = LLM.budget();
  const sum = {
    nr: cfg.nr, modus, seed: cfg.seed, stil: cfg.stil, spruenge: sprueng, tickEnde: ws.tickZahl, wall_s: (Date.now() - t0) / 1000, abbruch, grenzen,
    aufrufe: sl ? sl.aufrufe : 0, abenteuer_aufrufe: sl && sl.abenteuer ? sl.abenteuer.aufrufe : 0, status: sl ? sl.status() : null, zaehler: sl ? sl.zaehler : null,
    budget: { limit: budget1.limit, vorher_used: budget0.used, nachher_used: budget1.used, zaehler_delta: budget1.used - budget0.used, calls: budget1.calls },
    // LIV-02: kein Snapshot-Feld, kein Funk; der Stand kommt vom Server (Zaehler, Schwelle) und aus dem Regie-Logbuch (art kontingent)
    kontingent: { erreicht: require('../server/sim/kontingent.js').erreicht(), schwelle: require('../server/sim/kontingent.js').schwelle(), used: budget1.used },
    // LIV-01: der Zaehler (BUDGET) gilt prozessweit, nicht je Abend: war die Schwelle erreicht, fragte der Spielleiter dieses Abends (und aller spaeteren) nicht mehr; index.md weist das aus
    kontingent_gesperrt: logbuch.some((e) => e.art === 'kontingent' && e.ausgang === 'erreicht') || require('../server/sim/kontingent.js').erreicht(),
    fehlerServer: g.errors, angriffe_gesamt: z.angriffe.length, eroberungen: (ws.ereignisse || []).filter((e) => e.typ === 'hafen_gefallen').length, ereignisTypen: zaehle(ws.ereignisse || [], 'typ'), reise: ws.reise,
  };
  fs.writeFileSync(log('zusammenfassung.json'), JSON.stringify(sum, null, 1));
  console.log(`[Abend ${cfg.nr}${basis ? ' Basis' : ''}] fertig: ${JSON.stringify({ spruenge: sprueng, tick: ws.tickZahl, lageAufrufe: sum.aufrufe, abenteuerAufrufe: sum.abenteuer_aufrufe, tokens: sum.budget.zaehler_delta, abbruch, fehlerServer: g.errors })}`);
  const plaene = basis ? [] : planDateien(dir, cfg, calls, regieErgebnisse, logbuch, modus, LagePrompt);
  try { if (sl) sl.dispose(); } catch (e) { /* egal */ }
  return { sum, plaene };
}

// ---------- Plan-Dateien eines Abends: je Lage-Plan und je Abenteuer-Plan eine Markdown-Datei (+ Prompt-Datei), plaene.json mit den strukturierten Angaben
function planDateien(dir, cfg, calls, regieErgebnisse, logbuch, modus, LagePrompt) {
  const AP = require('../server/sim/abenteuer-prompt.js');
  const out = [];
  const nachArt = { lage: [], abenteuer: [] };
  for (const c of calls) if (nachArt[c.kind]) nachArt[c.kind].push(c);
  for (const kind of ['lage', 'abenteuer']) {
    const nrn = [...new Set(nachArt[kind].map((c) => c.nr))].sort((a, b) => a - b);
    for (const nr of nrn) {
      const aufn = nachArt[kind].filter((c) => c.nr === nr), a0 = aufn[0], a1 = aufn[aufn.length - 1];
      const art = kind === 'lage' ? 'lage_grobplan' : 'abenteuer_bauplan';
      const endAus = kind === 'lage' ? ['angewandt', 'plan_wirkungslos', 'fehler', 'veraltet'] : ['gueltig', 'abgelehnt', 'ausfall'];
      const eintrag = logbuch.filter((e) => e.art === art && e.plan && e.plan.nr === nr && endAus.includes(e.ausgang)).pop() || null;
      const gelesen = a1.antwort ? (kind === 'lage' ? LagePrompt.planAusText(a1.antwort.text) : AP.bauplanAusText(a1.antwort.text)) : null;
      const res = kind === 'lage' ? (regieErgebnisse.get(nr) || null) : null;
      const datei = `${kind}-${nn(nr)}.md`, promptDatei = `${kind}-${nn(nr)}.prompt.txt`;
      const rec = {
        abend: cfg.nr, art: kind, nr, datei: `abend${cfg.nr}/${datei}`, prompt_datei: `abend${cfg.nr}/${promptDatei}`, grenze: (eintrag && eintrag.plan && eintrag.plan.grenze) || a0.grenze || null, tick: a0.tick, zeit: a0.start,
        dauer_s: eintrag && Number.isFinite(eintrag.dauer_s) ? eintrag.dauer_s : a1.wall_s, tokens: eintrag ? eintrag.tokens : (a1.antwort ? a1.antwort.tokens : 0),
        kosten_usd: modus === 'live' && a1.antwort && Number.isFinite(Number(a1.antwort.cost)) ? Number(a1.antwort.cost) : (modus === 'live' ? null : 0),
        ausgang: eintrag ? eintrag.ausgang : (a1.fehler ? 'fehler' : 'kein_logeintrag'), grund: eintrag && eintrag.grund || null,
        befunde: eintrag && Array.isArray(eintrag.fehler) ? eintrag.fehler : (a1.fehler ? [a1.fehler] : []),
        rueckfall: kind === 'lage' ? !!eintrag && eintrag.ausgang === 'fehler' : false,
        anbieter: (eintrag && eintrag.anbieter) || (a1.antwort && a1.antwort.anbieter) || (modus === 'live' ? 'claude' : 'mock'), modell: (eintrag && eintrag.modell) || (a1.antwort && a1.antwort.modell) || (modus === 'live' ? null : 'mock'),
        cli: a1.antwort ? a1.antwort.cli : null, key: a1.antwort ? a1.antwort.key : null, aufnahme: modus === 'live' && a1.antwort && a1.antwort.key ? `regie/aufnahmen/${kind}/${a1.antwort.key}.json` : null, versuche: aufn.length, eskaliert: aufn.some((c) => c.eskaliert),
        plan: gelesen && gelesen.plan ? (kind === 'lage' ? { befehle: gelesen.plan.befehle || [], fokus: gelesen.plan.fokus || null, begruendung: gelesen.plan.begruendung || null } : { titel: gelesen.plan.titel || null, anlass: gelesen.plan.anlass || null, beats: (gelesen.plan.beats || []).map((b) => b && b.typ) }) : null,
        plan_sha1: gelesen && gelesen.plan ? Ablage.sha1(JSON.stringify(gelesen.plan)) : null,
        res, merkmale: kind === 'lage' ? promptMerkmale(a0.prompt) : null,
      };
      Ablage.schreibe(dir, promptDatei, typeof a0.prompt === 'string' ? a0.prompt : '(kein Prompt aufgenommen)\n');
      Ablage.schreibe(dir, datei, planMarkdown(rec, aufn, gelesen, eintrag, res, kind));
      out.push(rec);
    }
  }
  fs.writeFileSync(path.join(dir, 'plaene.json'), JSON.stringify(out, null, 1));
  return out;
}

function planMarkdown(rec, aufn, gelesen, eintrag, res, kind) {
  const befehle = res ? res.angenommen.length + res.abgelehnt.length : null;
  const fm = {
    abend: rec.abend, art: kind, aufruf: rec.nr, grenze: rec.grenze, tick: rec.tick, zeit: rec.zeit, dauer_s: rec.dauer_s, tokens: rec.tokens, kosten_usd: rec.kosten_usd,
    gueltigkeit: rec.ausgang, grund: rec.grund, pruefer_befunde: rec.befunde, rueckfall: rec.rueckfall, anbieter: rec.anbieter, modell: rec.modell, cli: rec.cli, key: rec.key, versuche: rec.versuche,
    aufnahme: rec.aufnahme, prompt_datei: path.basename(rec.prompt_datei),
  };
  if (res) Object.assign(fm, { befehle_vorgeschlagen: befehle, befehle_angenommen: res.angenommen.length, befehle_abgelehnt: res.abgelehnt.length, befehle_ausser_fokus: (rec.plan ? rec.plan.befehle : []).filter((b) => b && b.typ !== 'fokus').length });
  const L = [Ablage.frontmatter(fm), `# ${kind === 'lage' ? 'Lage-Plan' : 'Abenteuer-Plan'} ${rec.nr} (Abend ${rec.abend})`, '', `[zurück zum Index](../index.md) · [Prompt](${path.basename(rec.prompt_datei)})`, ''];
  if (kind === 'lage') {
    L.push('## Plan', '');
    const p = gelesen && gelesen.plan;
    if (!p) L.push(`_Kein lesbarer Plan_${gelesen && gelesen.fehler ? ' (' + gelesen.fehler + ')' : ''}.`, '');
    else {
      L.push(`**Begründung:** ${p.begruendung != null ? p.begruendung : '–'}`, '', `**Fokus:** ${p.fokus ? JSON.stringify(p.fokus) : '–'}`, '', '**Befehle:**', '');
      const bs = Array.isArray(p.befehle) ? p.befehle : [];
      if (!bs.length) L.push('_keine_');
      bs.forEach((b, i) => L.push(`${i + 1}. \`${b && b.typ}\` ${JSON.stringify(Object.assign({}, b, { typ: undefined }))}`));
      L.push('');
    }
    if (res) {
      L.push('## Ergebnis der Regie-Prüfung', '', `Angenommen (${res.angenommen.length}):`, '', ...(res.angenommen.map((a) => `- \`${a.typ}\` ${a.ziel || ''} ab Tick ${a.ab}${a.vorwarnung ? ' (mit Vorwarnung)' : ''}`)), res.angenommen.length ? '' : '_keine_', '', `Abgelehnt (${res.abgelehnt.length}):`, '', ...(res.abgelehnt.map((a) => `- \`${a.typ}\`: ${a.grund}`)), res.abgelehnt.length ? '' : '_keine_', '');
      if (res.funk && res.funk.length) L.push('Funk zum Plan:', '', ...res.funk.map((x) => '- ' + JSON.stringify(x)), '');
    }
  } else {
    L.push('## Plan', '', Ablage.planLesbar(gelesen));
    if (rec.ausgang !== 'gueltig') L.push('## Prüfer-Befund', '', `${rec.ausgang} (${rec.grund || '–'})`, '', ...rec.befunde.map((b) => '- ' + b), '');
  }
  aufn.forEach((a, i) => {
    L.push(`## Rohantwort${aufn.length > 1 ? ' (Versuch ' + (i + 1) + ')' : ''}`, '');
    if (a.antwort) L.push(Ablage.zaun(a.antwort.text, 'json')); else L.push(`_Keine Antwort: ${a.fehler || 'Fehler'}_`, '');
  });
  if (eintrag) L.push('## Logbuch-Eintrag', '', Ablage.zaun(JSON.stringify(eintrag, null, 2), 'json'));
  return L.join('\n');
}

// ---------- Auswertung: die vier Befunde vom 2026-10-24 als Zahlen, aus den Dateien eines Laufs
function auswertungBerechnen(lauf) {
  const abende = [];
  for (const d of fs.readdirSync(lauf, { withFileTypes: true })) {
    const m = d.isDirectory() && d.name.match(/^(basis-)?abend(\d+)$/);
    if (!m) continue;
    const dir = path.join(lauf, d.name);
    const plaene = fs.existsSync(path.join(dir, 'plaene.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'plaene.json'), 'utf8')) : [];
    const zus = fs.existsSync(path.join(dir, 'zusammenfassung.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'zusammenfassung.json'), 'utf8')) : null;
    abende.push({ name: d.name, nr: Number(m[2]), basis: !!m[1], plaene, zus, ticks: lies(path.join(dir, 'ticks.jsonl')), funk: lies(path.join(dir, 'funk.jsonl')).filter((x) => x.m && x.m.kind === 'radio') });
  }
  abende.sort((a, b) => a.nr - b.nr || (a.basis ? 1 : -1));
  const live = abende.filter((a) => !a.basis);
  const lage = live.flatMap((a) => a.plaene.filter((p) => p.art === 'lage'));
  const abent = live.flatMap((a) => a.plaene.filter((p) => p.art === 'abenteuer'));
  const mitRes = lage.filter((p) => p.res);   // Plan wurde angewandt (gelesen und geprueft)
  const ausserFokus = (befehle) => (befehle || []).filter((b) => b && b.typ !== 'fokus');
  const B = {};
  // Befund 1: die Befehlsrate frisst den Plan
  B.b1 = {
    plaene_gesamt: lage.length, plaene_geprueft: mitRes.length,
    mit_befehl_ausser_fokus_vorgeschlagen: mitRes.filter((p) => ausserFokus(p.plan && p.plan.befehle).length > 0).length,
    mit_befehl_ausser_fokus_angenommen: mitRes.filter((p) => p.res.angenommen.some((a) => a.typ !== 'fokus')).length,
    befehle_vorgeschlagen: mitRes.reduce((s, p) => s + p.res.angenommen.length + p.res.abgelehnt.length, 0),
    befehle_angenommen: mitRes.reduce((s, p) => s + p.res.angenommen.length, 0),
    rate_ablehnungen: mitRes.reduce((s, p) => s + p.res.abgelehnt.filter((a) => /^Rate:/.test(a.grund)).length, 0),
    plaene_mit_rate_ablehnung: mitRes.filter((p) => p.res.abgelehnt.some((a) => /^Rate:/.test(a.grund))).length,
    uebersprungen_rate: live.reduce((s, a) => s + ((a.zus && a.zus.zaehler && a.zus.zaehler.uebersprungen && a.zus.zaehler.uebersprungen.rate) || 0), 0),
  };
  // Befund 2: Claude sieht die Ablehnungen nicht
  const abgelehntGes = mitRes.reduce((s, p) => s + p.res.abgelehnt.length, 0);
  const folgeprompts = live.flatMap((a) => { const l = a.plaene.filter((p) => p.art === 'lage').sort((x, y) => x.nr - y.nr); return l.slice(1).map((p, i) => ({ p, davor: l[i] })); });
  const nachAblehnung = folgeprompts.filter((x) => x.davor.res && x.davor.res.abgelehnt.length > 0);
  B.b2 = {
    befehle_abgelehnt: abgelehntGes, ablehnquote: (B.b1.befehle_vorgeschlagen ? abgelehntGes / B.b1.befehle_vorgeschlagen : null),
    gruende: zaehle(mitRes.flatMap((p) => p.res.abgelehnt.map((a) => ({ g: grundArt(a.grund) }))), 'g'),
    folgeprompts: folgeprompts.length, folgeprompts_nach_ablehnung: nachAblehnung.length,
    davon_mit_ablehnung_im_prompt: nachAblehnung.filter((x) => x.p.merkmale && x.p.merkmale.letzte_abgelehnt > 0).length,
    prompts_mit_ergebnissen: lage.filter((p) => p.merkmale && p.merkmale.letzte_befehle > 0).length,
  };
  // Befund 3: der Ausschnitt ohne Entscheidungsgrundlagen
  B.b3 = {
    prompts: lage.length, mit_befehle_frei: lage.filter((p) => p.merkmale && p.merkmale.befehle_frei).length, mit_letzte_plaene: lage.filter((p) => p.merkmale && p.merkmale.letzte_plaene > 0).length,
    rate_null_im_prompt: lage.filter((p) => p.merkmale && p.merkmale.rate === 0).length,
    ablehnungen_nach_voraussetzung: abgelehntGes - B.b1.rate_ablehnungen,
    ausschnitt_zeichen_median: Ablage.median(lage.map((p) => p.merkmale && p.merkmale.ausschnitt_zeichen).filter(Number.isFinite)),
  };
  // Befund 4: Absicht und Vorwarnung ungetestet
  const vorw = mitRes.flatMap((p) => p.res.angenommen.filter((a) => a.vorwarnung));
  B.b4 = {
    plaene_an_grenze_absicht: lage.filter((p) => p.grenze === 'absicht').length,
    absicht_der_crew_gesetzt: live.some((a) => a.ticks.some((t) => t.absichten && Object.keys(t.absichten).length > 0)),
    absicht_ticks: live.reduce((s, a) => s + a.ticks.filter((t) => t.absichten && Object.keys(t.absichten).length > 0).length, 0),
    vorwarnung_befehle: vorw.length, plaene_mit_vorwarnung: mitRes.filter((p) => p.res.angenommen.some((a) => a.vorwarnung)).length,
    funk_zum_plan: mitRes.reduce((s, p) => s + ((p.res.funk && p.res.funk.length) || 0), 0), funk_meldungen_gesamt: live.reduce((s, a) => s + a.funk.length, 0),
  };
  // Gueltigkeit, Dauer, Kosten (beide Arten)
  const stat = (liste) => {
    const dauer = liste.map((p) => p.dauer_s).filter(Number.isFinite), geld = liste.map((p) => p.kosten_usd).filter(Number.isFinite);
    const shas = liste.map((p) => p.plan_sha1).filter(Boolean);
    return { n: liste.length, ausgaenge: zaehle(liste, 'ausgang'), dauer_median_s: Ablage.median(dauer), dauer_p90_s: Ablage.perzentil(dauer, 90), tokens: liste.reduce((s, p) => s + (p.tokens || 0), 0), kosten_usd: geld.length ? geld.reduce((s, x) => s + x, 0) : null, gleiche_plaene: shas.length - new Set(shas).size };
  };
  // Vergleich mit der Basis: erste Abweichung, Ereignisse
  const vergleiche = [];
  for (const a of live) {
    const b = abende.find((x) => x.basis && x.nr === a.nr);
    if (!b || !a.ticks.length || !b.ticks.length) continue;
    const sig = (x) => JSON.stringify([x.tick, x.hex, x.ereignisse.map((e) => [e.typ, e.fraktion, e.ort, e.ziel]), x.besitzwechsel, x.embargo, x.mieten, x.angriffe_gesamt, x.flotten_aktiv]);
    let div = null; for (let i = 0; i < Math.min(a.ticks.length, b.ticks.length); i++) if (sig(a.ticks[i]) !== sig(b.ticks[i])) { div = i; break; }
    const summe = (T) => { const c = {}; let bw = 0; for (const x of T) { bw += x.besitzwechsel.length; for (const e of x.ereignisse) c[e.typ] = (c[e.typ] || 0) + 1; } return { ereignisse: c, besitzwechsel: bw, angriffe: T[T.length - 1].angriffe_gesamt }; };
    vergleiche.push({ abend: a.nr, erste_abweichung_sprung: div === null ? null : a.ticks[div].j, erste_abweichung_tick: div === null ? null : a.ticks[div].tick, live: summe(a.ticks), basis: summe(b.ticks), eroberungen_live: a.zus && a.zus.eroberungen, eroberungen_basis: b.zus && b.zus.eroberungen });
  }
  return { abende: abende.map((a) => ({ name: a.name, nr: a.nr, basis: a.basis, plaene: a.plaene.length, sprunge: a.zus && a.zus.spruenge })), lage: stat(lage), abenteuer: stat(abent), befunde: B, vergleiche };
}

function auswertungSchreiben(lauf, A, kopf, modus, name) {
  name = name || 'auswertung';
  const B = A.befunde, f1 = (x) => (x == null ? '–' : f(x * 100, 10) + ' %');
  const ja = (x) => (x ? 'ja' : 'nein');
  const L = [Ablage.frontmatter({ titel: 'Auswertung der vier Befunde', werkzeug: 'tools/messe-lage.js', modus, erstellt: new Date().toISOString() }), '# Auswertung: die vier Befunde vom 2026-10-24', '', kopf, ''];
  if (modus !== 'live') L.push('> [!warning] Mock-Lauf: Die Zahlen prüfen das Werkzeug und die Kette. Über das Verhalten von Claude sagen sie nichts; dafür braucht es einen Lauf mit `--live`.', '');
  L.push('## 1. Die Befehlsrate frisst den Plan', '',
    `- Lage-Pläne gesamt ${B.b1.plaene_gesamt}, davon geprüft (gelesen und angewandt) ${B.b1.plaene_geprueft}`,
    `- Pläne mit Befehl außer \`fokus\` vorgeschlagen: ${B.b1.mit_befehl_ausser_fokus_vorgeschlagen} von ${B.b1.plaene_geprueft} (${pz(B.b1.mit_befehl_ausser_fokus_vorgeschlagen, B.b1.plaene_geprueft)})`,
    `- Pläne mit angenommenem Befehl außer \`fokus\`: ${B.b1.mit_befehl_ausser_fokus_angenommen} von ${B.b1.plaene_geprueft} (${pz(B.b1.mit_befehl_ausser_fokus_angenommen, B.b1.plaene_geprueft)}) (2026-10-24: 1 von 12)`,
    `- Befehle vorgeschlagen ${B.b1.befehle_vorgeschlagen}, angenommen ${B.b1.befehle_angenommen}`,
    `- Rate-Erschöpfung: ${B.b1.rate_ablehnungen} Befehle abgelehnt mit „Rate:“ in ${B.b1.plaene_mit_rate_ablehnung} Plänen; ${B.b1.uebersprungen_rate} Grenzen ohne Aufruf übersprungen, weil die Rate leer war`, '');
  L.push('## 2. Claude sieht die Ablehnungen nicht', '',
    `- Befehle abgelehnt ${B.b2.befehle_abgelehnt} von ${B.b1.befehle_vorgeschlagen} (Ablehnquote ${f1(B.b2.ablehnquote)})`,
    `- Gründe: ${Object.entries(B.b2.gruende).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'keine'}`,
    `- Folge-Prompts nach einem Plan mit Ablehnungen: ${B.b2.folgeprompts_nach_ablehnung} (von ${B.b2.folgeprompts} Folge-Prompts); davon mit „abgelehnt“ im Block letzte_plaene: ${B.b2.davon_mit_ablehnung_im_prompt}`,
    `- Prompts mit Befehls-Ergebnissen in letzte_plaene: ${B.b2.prompts_mit_ergebnissen} von ${B.b3.prompts}`, '');
  L.push('## 3. Der Ausschnitt ohne Entscheidungsgrundlagen', '',
    `- Prompts mit \`befehle_frei\` im Ausschnitt: ${B.b3.mit_befehle_frei} von ${B.b3.prompts} (${pz(B.b3.mit_befehle_frei, B.b3.prompts)}); mit letzte_plaene: ${B.b3.mit_letzte_plaene}`,
    `- Prompts, in denen die Rate schon 0 war: ${B.b3.rate_null_im_prompt}`,
    `- Ablehnungen aus anderen Gründen als der Rate (Voraussetzungen, Regeln, Wiederholung): ${B.b3.ablehnungen_nach_voraussetzung}`,
    `- Ausschnitt im Median ${f(B.b3.ausschnitt_zeichen_median)} Zeichen`, '');
  L.push('## 4. Absicht und Vorwarnung ungetestet', '',
    `- Pläne an der Grenze \`absicht\`: ${B.b4.plaene_an_grenze_absicht}`,
    `- Absicht der Crew gesetzt (z.absichten nicht leer): ${ja(B.b4.absicht_der_crew_gesetzt)} (${B.b4.absicht_ticks} Sprünge mit gesetzter Absicht)`,
    `- Angenommene Befehle mit Vorwarnung: ${B.b4.vorwarnung_befehle} in ${B.b4.plaene_mit_vorwarnung} Plänen; Funk zu Plänen ${B.b4.funk_zum_plan}, Funkmeldungen im Lauf gesamt ${B.b4.funk_meldungen_gesamt}`, '');
  const art = (n, s) => `- ${n}: ${s.n} Pläne; Ausgänge ${Object.entries(s.ausgaenge).map(([k, v]) => `${k} ${v}`).join(', ') || '–'}; Dauer Median ${f(s.dauer_median_s, 100)} s, p90 ${f(s.dauer_p90_s, 100)} s; Tokens ${f(s.tokens)}; Kosten ${s.kosten_usd != null ? f(s.kosten_usd, 10000) + ' USD' : 'nicht gemeldet'}; gleiche Pläne ${s.gleiche_plaene}`;
  L.push('## Gültigkeit, Dauer, Kosten', '', art('Lage-Pläne', A.lage), art('Abenteuer-Pläne', A.abenteuer), '');
  if (A.vergleiche.length) {
    L.push('## Vergleich mit dem Abend ohne Spielleiter', '');
    for (const v of A.vergleiche) L.push(`- Abend ${v.abend}: erste Abweichung ${v.erste_abweichung_sprung === null ? 'keine' : 'bei Sprung ' + v.erste_abweichung_sprung + ' (Tick ' + v.erste_abweichung_tick + ')'}; mit Spielleiter ${JSON.stringify(v.live)}, Eroberungen ${v.eroberungen_live}; ohne ${JSON.stringify(v.basis)}, Eroberungen ${v.eroberungen_basis}`);
    L.push('');
  }
  fs.writeFileSync(path.join(lauf, name + '.md'), L.join('\n'), { flag: 'wx' });
  fs.writeFileSync(path.join(lauf, name + '.json'), JSON.stringify(A, null, 1), { flag: 'wx' });
}

function indexSchreiben(lauf, o, modus, ergebnisse, A, t0, kopf) {
  const L = [Ablage.frontmatter({ titel: 'Messung Spielleiter (Lage und Abenteuer)', werkzeug: 'tools/messe-lage.js', modus, abende: o.abende, erstellt: new Date().toISOString() }), '# Messung des Spielleiters in simulierten Abenden', '', kopf, ''];
  const live = ergebnisse.filter((e) => !e.basis);
  const bud = live.reduce((s, e) => s + e.sum.budget.zaehler_delta, 0);
  const LLM = require('../server/mission/llm.js');
  L.push('## Zusammenfassung', '', `- Laufzeit ${f((Date.now() - t0) / 1000, 10)} s; Abende ${o.abende.join(', ')}; FAEDEN ${o.faeden ? 'an' : 'aus'}`,
    `- Tokens gegen CLAUDE_TOKEN_BUDGET: ${f(bud)} von ${f(LLM.budget().limit)} (${LLM.budget().limit ? f((100 * bud) / LLM.budget().limit, 100) + ' %' : '–'}); der Zähler zählt nur Claude-Läufe`);
  for (const [n, s] of [['Lage-Pläne', A.lage], ['Abenteuer-Pläne', A.abenteuer]]) L.push(`- ${n}: ${s.n}; ${Object.entries(s.ausgaenge).map(([k, v]) => `${k} ${v}`).join(', ') || '–'}; Dauer Median ${f(s.dauer_median_s, 100)} s, p90 ${f(s.dauer_p90_s, 100)} s; Tokens ${f(s.tokens)}; Kosten ${s.kosten_usd != null ? f(s.kosten_usd, 10000) + ' USD' : 'nicht gemeldet'}; gleiche Pläne ${s.gleiche_plaene}`);
  L.push('- Der Token-Zähler gilt prozessweit: alle Abende dieses Laufs teilen ihn (Limit CLAUDE_TOKEN_BUDGET, Schwelle 90 %).');
  const gesperrt = live.filter((e) => e.sum.kontingent_gesperrt);
  if (gesperrt.length) L.push(`- **Kontingent erreicht: Abend ${gesperrt.map((e) => e.nr).join(', ')} war wegen des Kontingents gesperrt** (Zähler ab der Schwelle von ${f(require('../server/sim/kontingent.js').schwelle())} Tokens). Der Spielleiter fragte dort nicht mehr; die Pläne dieser Abende kommen aus dem Rückfall, nicht vom Modell, und alle späteren Abende dieses Laufs sind ebenfalls gesperrt. Neuer Lauf oder höheres CLAUDE_TOKEN_BUDGET nötig.`);
  L.push('- Auswertung der vier Befunde: [auswertung.md](auswertung.md); Rohdaten: [messung.json](messung.json)', '');
  for (const art of ['lage', 'abenteuer']) {
    const zeilen = live.flatMap((e) => e.plaene.filter((p) => p.art === art));
    L.push(`## ${art === 'lage' ? 'Lage-Pläne' : 'Abenteuer-Pläne'}`, '');
    if (!zeilen.length) { L.push('_keine_', ''); continue; }
    L.push('| Abend | Nr | Plan | Grenze | Tick | Ausgang | Grund | Dauer s | Tokens | Kosten USD | Inhalt |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const p of zeilen) {
      const inhalt = art === 'lage' ? (p.res ? `${p.res.angenommen.length} angenommen, ${p.res.abgelehnt.length} abgelehnt` : '–') : ((p.plan && p.plan.titel) || '');
      L.push(`| ${p.abend} | ${p.nr} | [${path.basename(p.datei)}](${p.datei}) | ${p.grenze || '–'} | ${p.tick} | ${p.ausgang} | ${Ablage.zelle(p.grund || '')} | ${f(p.dauer_s, 100)} | ${f(p.tokens)} | ${p.kosten_usd != null && modus === 'live' ? f(p.kosten_usd, 10000) : '–'} | ${Ablage.zelle(inhalt)} |`);
    }
    L.push('');
  }
  fs.writeFileSync(path.join(lauf, 'index.md'), L.join('\n'));
}

async function main() {
  const o = aufrufLesen();
  if (o.auswerten) {
    const lauf = path.resolve(START_CWD, o.auswerten);
    if (!fs.existsSync(lauf) || !fs.statSync(lauf).isDirectory()) { console.error('Lauf-Ordner nicht gefunden: ' + lauf); process.exit(2); }
    const A = auswertungBerechnen(lauf);
    const modus = fs.existsSync(path.join(lauf, 'messung.json')) ? (JSON.parse(fs.readFileSync(path.join(lauf, 'messung.json'), 'utf8')).modus || 'mock') : 'mock';
    // die vorhandene auswertung.md bleibt: neue Dateien mit Zeitstempel (wx: nie ueberschreiben)
    const name = `auswertung-${Ablage.zeit()}`;
    auswertungSchreiben(lauf, A, `Neu ausgewertet aus ${lauf}`, modus, name);
    const ziel = path.join(lauf, name + '.md');
    console.log(`Auswertung: ${ziel}`);
    return;
  }
  const modus = o.live ? 'live' : 'mock';
  const LLM = require('../server/mission/llm.js');
  if (o.live) {
    const cli = LLM.claudeFinden();
    if (process.env.LLM_LIVE !== '1') { console.log('Messung Lage/Abenteuer: nicht gemessen (LLM_LIVE=1 ist nicht gesetzt; echte Aufrufe kosten Geld und laufen nur von Hand).'); return; }
    if (!cli.cmd) { console.log(`Messung Lage/Abenteuer: nicht gemessen (Claude-CLI nicht gefunden; versucht: ${cli.versucht.join(', ') || 'nichts'}; CLAUDE_CLI setzen).`); return; }
    console.log(`Claude-CLI: ${cli.quelle}; Token-Deckel ${LLM.budget().limit} (CLAUDE_TOKEN_BUDGET), Lage-Aufrufe je Abend hoechstens ${o.plaene}`);
  }
  let lauf;
  try { lauf = Ablage.laufOrdner(o.wurzel, 'lage-' + modus); } catch (e) { console.error(e.message); process.exit(2); }
  const t0 = Date.now();
  const ergebnisse = [];
  LLM.resetBudget();
  for (const nr of o.abende) {
    const e = await abend(ABENDE[nr], o, path.join(lauf, 'abend' + nr), modus);
    ergebnisse.push(Object.assign({ basis: false, nr }, e));
    if (o.mitBasis) { const b = await abend(ABENDE[nr], o, path.join(lauf, 'basis-abend' + nr), 'basis'); ergebnisse.push(Object.assign({ basis: true, nr }, b)); }
    if (e.sum.abbruch) { console.log('ABBRUCH: ' + e.sum.abbruch); break; }
  }
  const kopf = `Aufruf: \`node tools/messe-lage.js ${args.join(' ')}\`; Modus ${modus}; Zeit ${new Date().toISOString()}`;
  fs.writeFileSync(path.join(lauf, 'messung.json'), JSON.stringify({ format: 'messung-lage/1', werkzeug: 'tools/messe-lage.js', aufruf: args, modus, faeden: o.faeden, abende: o.abende, plaene_je_abend: o.plaene, erstellt: new Date().toISOString(), budget: LLM.budget(), abende_ergebnis: ergebnisse.map((e) => ({ nr: e.nr, basis: e.basis, zusammenfassung: e.sum, plaene: e.plaene })) }, null, 1));
  const A = auswertungBerechnen(lauf);
  auswertungSchreiben(lauf, A, kopf, modus);
  indexSchreiben(lauf, o, modus, ergebnisse, A, t0, kopf);
  const nPlaene = ergebnisse.reduce((s, e) => s + e.plaene.length, 0);
  console.log(`Budget gesamt: ${JSON.stringify(LLM.budget())}`);
  console.log(`Ablage: ${lauf} (index.md, auswertung.md, messung.json, ${nPlaene} Plan-Dateien)`);
  const fehlerServer = ergebnisse.reduce((s, e) => s + (e.sum.fehlerServer || 0), 0);
  if (fehlerServer) { console.log(`Serverfehler im Lauf: ${fehlerServer}`); process.exitCode = 1; }
}
if (require.main === module) main().then(() => process.exit(process.exitCode || 0), (e) => { console.error('Abbruch: ' + (e && e.stack)); process.exit(1); });
module.exports = { promptMerkmale, auswertungBerechnen, grundArt };
