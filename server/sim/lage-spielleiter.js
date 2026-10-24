'use strict';
// SUND-03 A2: Lage-Spielleiter der Freien Fahrt Sund (game.weltsim). Er plant an TÄTIGKEITSGRENZEN mit Claude einen Grobplan (Absichten/Befehle als JSON, Katalog aus Paket A) und gibt ihn an
// Regie.planAnwenden (Vorwarnung, Prüfung, Rückfall). Das Spiel wartet NIE auf ihn: die Anfrage läuft asynchron, das Ergebnis wird im nächsten update(dt) zwischen den Ticks abgeholt. Fällt er aus
// (Schalter, Budget, Timeout, Fehler, ungültiger Plan, dispose), läuft die Welt mit der Standard-KI weiter (Regie.rueckfall). Der Mission-Spielleiter (server/mission/spielleiter.js) bleibt an
// Kampagne und Missionsbuch gebunden und in der Freien Fahrt gesperrt; dies ist eine eigene, schlanke Klasse mit einem Job.
//
// Grenzen (Daten content/welt/lage-spielleiter-werte.json, Hooks in game.js und kriegslage.js über game.lageGrenze(art)):
//   szene_ende  Ende einer Sim-Szene (Kriegslage.szeneAbschliessen, wo 'szene')      andocken  Andocken (missionEvent docked)      absicht  Wahl oder Ablehnung einer Strategischen Option
// Zusätzlich: Mindestabstand in Ticks zwischen zwei Plänen, Deckel an Anfragen je Sitzung („Abend“), Budget (CLAUDE_TOKEN_BUDGET, min_budget), nie zwei Jobs zugleich.
//
//   const mod = LageSpielleiter; mod.schalterAn(env)   SPIELLEITER_LLM ≠ off UND LAGE_SPIELLEITER=1 (Standard aus: der Bestand läuft ohne Env unverändert)
//   const sl = mod.create(game, opts)     opts: { llm, mode, env, werte (überschreibt Daten), transport, regieDir }
//   sl.beiGrenze(art) -> { gestartet, grund }     sl.update(dt)     sl.dispose()     sl.status()     sl.debug(args)
//
// Zustand (Ein-Job): zustand 'idle' | 'angefragt' (Grenze erkannt, Prompt wird im nächsten update gebaut) | 'laeuft' (Antwort in der Luft); job { token, art, nr, startTick, start (Spielzeit), wall };
// letzte_plaene: kleine Ringliste kurzer Pläne für den nächsten Prompt (Datenstelle für Wiederholungsregeln, spätere Pakete).
// Jede Messung (Dauer, Tokens, Anbieter, Ausgang) steht als art 'lage_grobplan' im Regie-Logbuch (tools/regie-bericht.js).
const path = require('path');
const LLM = require('../mission/llm.js');
const Regie = require('./regie-befehle.js');
const Prompt = require('./lage-prompt.js');
const Wiederholung = require('./lage-wiederholung.js');   // SUND-03 D: Wiederholungsregeln der Pläne
const Chronik = require('./chronik.js');   // SUND-03 D: angewandte Pläne stehen in der Chronik

const DATEN = require('../../content/welt/lage-spielleiter-werte.json').werte;
const WERTE = Object.fromEntries(Object.entries(DATEN).map(([k, v]) => [k, v.wert]));

// Modus aus der Umgebung wie der Spielleiter der Kampagne: live nur mit SPIELLEITER_LLM=live UND LLM_LIVE=1
function modusAusEnv(env) {
  const e = env || process.env;
  const m = String(e.SPIELLEITER_LLM || 'off').toLowerCase();
  if (m === 'live') return e.LLM_LIVE === '1' ? 'live' : 'off';
  if (m === 'mock') return 'mock';
  return 'off';
}
function schalterAn(env) {
  const e = env || process.env;
  return String(e.LAGE_SPIELLEITER || '') === '1' && String(e.SPIELLEITER_LLM || 'off').toLowerCase() !== 'off';
}

const kurzBefehl = (b) => {
  if (!b || typeof b !== 'object') return String(b).slice(0, 40);
  const t = [b.typ];
  for (const k of ['fraktion', 'an', 'gegen', 'ziel', 'sektor', 'ort', 'hex', 'flotte']) if (b[k] !== undefined) t.push(b[k]);
  return t.join(' ').slice(0, 60);
};

// SUND-03 F: ein Befehl der letzten Pläne mit Ergebnis: "angreifen ger 0105: ok" | "embargo rom: abgelehnt (Rate: höchstens 8 …)". Der Plan-Fokus (ein Befehl je Fraktion) erscheint einmal.
function befehlErgebnis(b, grund, maxGrund) {
  const t = kurzBefehl(b);
  return grund == null ? t + ': ok' : t + ': abgelehnt (' + String(grund).replace(/\s+/g, ' ').slice(0, maxGrund) + ')';
}
function ergebnisse(res, wh, maxGrund) {
  const out = []; let fokusOk = false, fokusNein = false;
  for (const a of res.angenommen) { if (a.befehl.typ === 'fokus') { if (fokusOk) continue; fokusOk = true; } out.push(befehlErgebnis(a.befehl, null, maxGrund)); }
  for (const a of res.abgelehnt.concat(wh.abgelehnt)) {
    if (a.befehl && a.befehl.typ === 'fokus') { if (fokusOk || fokusNein) continue; fokusNein = true; }
    out.push(befehlErgebnis(a.befehl, a.grund, maxGrund));
  }
  return out;
}

class LageSpielleiter {
  constructor(game, opts) {
    const o = opts || {};
    this.game = game;
    this.env = o.env || game.env || process.env;
    this.W = Object.assign({}, WERTE, o.werte || {});
    this.opts = o;
    this.llm = o.llm || null;
    this.mode = o.llm ? o.llm.mode : (o.mode || modusAusEnv(this.env));
    this.zustand = 'idle';
    this.job = null;
    this.seq = 0;
    this.inbox = [];
    this.aufrufe = 0;            // gestartete Anfragen dieser Sitzung (Deckel)
    this.letzterStartTick = null;
    this.letzte_plaene = [];     // Ringliste kurzer Pläne { nr, tick, grenze, befehle: [Text], angenommen, abgelehnt, begruendung }
    this.zaehler = { angewandt: 0, wirkungslos: 0, fehler: 0, veraltet: 0, uebersprungen: {} };
    this.failNext = false;
    this.aus = null;             // Grund, wenn der Transport für diese Sitzung aus ist (CLI fehlt)
    this.ausGemeldet = false;
    this.disposed = false;
    this.sitzung = (game.runId || ('lage-' + Date.now())) + '';
  }

  // SUND-03 D-Fix2: Identitätsschlüssel der angenommenen Befehle je angewandtem Plan (Wiederholungsregeln, nicht im Prompt); steht im Weltstand (welt.sim.regie.verlauf), damit Laden und Neustart die Regel nicht aushebeln
  get verlauf() {
    const r = this.game.weltsim && this.game.weltsim.regie;
    if (!r) return this._verlauf || (this._verlauf = []);
    return r.verlauf || (r.verlauf = []);
  }

  // ---------- Hilfen
  getLlm() {
    if (!this.llm) {
      try {
        const create = { mode: this.mode, recordDir: path.join(this.opts.regieDir || require('../mission/regielog.js').dir(this.env), 'aufnahmen') };
        let router = this.opts.transport || null;
        if (!router && this.mode === 'live') router = require('../mission/transport-router.js').routerAusEnv(this.env);
        if (router) create.transport = router;
        this.llm = LLM.create(create);
      } catch (e) { this.fehlerZaehlen('lage-llm', e); this.llm = LLM.create({ mode: 'off' }); }
    }
    return this.llm;
  }
  fehlerZaehlen(wo, e) { if (this.game.countError) this.game.countError(wo, e); }
  schreibe(eintrag) { Regie.schreibe(this.game, Object.assign({ art: 'lage_grobplan', quelle: this.mode === 'mock' || this.mode === 'script' ? 'mock' : 'llm' }, eintrag)); }
  bereit() { return !this.disposed && !!this.game.weltsim; }
  // Übersprungene Grenze: gezählt immer, im Logbuch höchstens einmal je Tick und Grund (K1: keine Flut), der Grund steht im eigenen Feld `grund`
  ueberspringen(grund, art) {
    const tick = this.game.weltsim.tickZahl;
    this.zaehler.uebersprungen[grund] = (this.zaehler.uebersprungen[grund] || 0) + 1;
    const schluessel = tick + ':' + grund;
    if (this.letzterSprung !== schluessel) {
      this.letzterSprung = schluessel;
      this.schreibe({ ausgang: 'uebersprungen', grund, begruendung: `Grenze ${art}: kein Plan (${grund})`, plan: { grenze: art, tick, sitzung: this.sitzung, aufrufe: this.aufrufe } });
    }
    return { gestartet: false, grund };
  }

  // ---------- Grenze: nur prüfen und vormerken, nichts Schweres (der Aufruf kommt aus Hooks mitten im Spiel)
  beiGrenze(art) {
    if (!this.bereit()) return { gestartet: false, grund: 'dispose' };
    if (!this.W.grenzen.includes(art)) return { gestartet: false, grund: 'keine_grenze' };
    const takt = this.taktErlaubt(art);
    return takt || this.anfrageVormerken(art);
  }
  // Takt der Sitzung: Deckel und Mindestabstand. -> null (erlaubt) | Ergebnis des Überspringens. Nur beiGrenze ruft sie.
  taktErlaubt(art) {
    if (this.aufrufe >= this.W.deckel_je_sitzung) return this.ueberspringen('deckel', art);
    if (this.letzterStartTick != null && this.game.weltsim.tickZahl - this.letzterStartTick < this.W.min_abstand_ticks) return this.ueberspringen('abstand', art);
    return null;
  }
  // Debug (lage plan): wie eine Grenze, aber ohne Abstand und Deckel (Budget und „nur ein Job“ gelten weiter).
  planErzwingen() {
    if (!this.bereit()) return { gestartet: false, grund: 'dispose' };
    return this.anfrageVormerken('debug');
  }
  // Kern: Modus, Transport, ein Job zugleich, Budget, dann vormerken (ohne Takt-Prüfung)
  anfrageVormerken(art) {
    const ws = this.game.weltsim;
    if (this.mode === 'off' || (this.llm && this.llm.mode === 'off')) {
      if (!this.ausGemeldet) { this.ausGemeldet = true; Regie.rueckfall(this.game, 'Lage-Spielleiter aus (Modus off)'); }
      return { gestartet: false, grund: 'aus' };
    }
    if (this.aus) return this.ueberspringen('transport_aus', art);
    if (this.zustand !== 'idle') return this.ueberspringen('beschaeftigt', art);
    // SUND-03 F2: Rate erschöpft: jeder Befehl scheiterte an der Rate, der Aufruf wäre zwecklos (kein Claude-Aufruf, zählt nicht gegen den Deckel)
    if (Regie.befehleFrei(this.game).rate === 0) return this.ueberspringen('rate', art);
    const b = LLM.budget();
    if (b.remaining < this.W.min_budget) {
      // Rückfall und Logbuch nur EINMAL je Zustand „Budget leer“; jede weitere Grenze wird nur übersprungen und rührt die Regie nicht neu an
      if (this.budgetGemeldet) return this.ueberspringen('budget', art);
      this.budgetGemeldet = true;
      Regie.rueckfall(this.game, `Token-Budget fast leer (${b.used} von ${b.limit}, Rest < ${this.W.min_budget})`);
      this.schreibe({ ausgang: 'fehler', grund: 'budget', fehler: ['BUDGET'], budget: { used: b.used, limit: b.limit }, begruendung: 'Grenze ' + art + ': Budget leer', plan: { grenze: art, tick: ws.tickZahl, sitzung: this.sitzung } });
      this.zaehler.fehler++;
      return { gestartet: false, grund: 'budget' };
    }
    this.budgetGemeldet = false;
    this.aufrufe++;
    this.letzterStartTick = ws.tickZahl;
    this.zustand = 'angefragt';
    this.job = { token: 0, art, nr: this.aufrufe, startTick: ws.tickZahl, start: this.game.time, wall: null };
    return { gestartet: true, grund: null };
  }

  // ---------- Tick-Pfad (zwischen den Ticks): abholen, Frist prüfen, vorgemerkte Anfrage starten
  update(dt) {
    if (!this.bereit()) return;
    this.abholen();
    this.fristPruefen();
    if (this.zustand === 'angefragt') this.starten();
  }
  starten() {
    const job = this.job;
    if (!job) { this.zustand = 'idle'; return; }
    if (this.failNext) { this.failNext = false; return this.stoerung(job, LLM.llmError('EXIT', 'Debug: lage fail'), null); }
    let bau;
    try { bau = Prompt.baue(this.game, { art: job.art, nr: job.nr, letzte: this.letzte_plaene, werte: this.W }); } catch (e) { this.fehlerZaehlen('lage-prompt', e); return this.stoerung(job, LLM.llmError('EXIT', 'Prompt nicht baubar: ' + e.message), null); }
    if (bau.fehler) return this.stoerung(job, LLM.llmError('EXIT', bau.fehler), null);
    job.bau = { zeichen: bau.zeichen, stufe: bau.ausschnitt.stufe, ausschnitt_zeichen: bau.ausschnitt.zeichen };
    job.token = ++this.seq; job.start = this.game.time; job.wall = Date.now(); job.startTick = this.game.weltsim.tickZahl;
    this.zustand = 'laeuft';
    const input = { system: Prompt.SYSTEM_DATEI, prompt: bau.prompt, art: job.art, nr: job.nr };
    let p;
    job.abbruch = new AbortController();   // dispose und Timeout beenden den Transport (CLI-Prozess), statt ihn bis zum eigenen Timer laufen zu lassen
    try { p = this.getLlm().ask('lage', input, { timeoutMs: 1000 * this.W.timeout_s, signal: job.abbruch.signal }); } catch (e) { p = Promise.reject(e); }
    const token = job.token;
    Promise.resolve(p).then((r) => { if (!this.disposed) this.inbox.push({ token, r }); }, (e) => { if (!this.disposed) this.inbox.push({ token, e }); });
  }
  abholen() {
    while (this.inbox.length) {
      const it = this.inbox.shift();
      const job = this.job;
      if (!job || job.token !== it.token) {
        // späte Antwort (Frist schon behandelt, anderer Job): verwerfen, nur die Tokens stehen im Logbuch (der Zähler in llm.js zählt sie ohnehin). Ein eigener Abbruch (ABORTED) ist keine späte Antwort.
        if (it.e && it.e.code === 'ABORTED') continue;
        this.schreibe({ ausgang: 'verspaetet', tokens: it.r ? it.r.tokens : 0, begruendung: 'Antwort nach Zeitüberschreitung verworfen', plan: { sitzung: this.sitzung } });
        continue;
      }
      this.job = null; this.zustand = 'idle';
      if (it.e) this.stoerung(job, it.e, null);
      else { try { this.antwort(job, it.r); } catch (e) { this.fehlerZaehlen('lage-antwort', e); this.stoerung(job, LLM.llmError('EXIT', 'Plan nicht anwendbar: ' + e.message), it.r); } }
    }
  }
  // Beendet den Transport der Anfrage (AbortSignal an llm.ask → CLI-Prozess bzw. Ollama-Aufruf)
  anfrageAbbrechen(job) { if (job && job.abbruch) { try { job.abbruch.abort(); } catch (e) { this.fehlerZaehlen('lage-abort', e); } } }
  fristPruefen() {
    const job = this.job;
    if (!job || this.zustand !== 'laeuft') return;
    if (this.game.time - job.start > this.W.timeout_s + 1) {
      this.job = null; this.zustand = 'idle';
      this.anfrageAbbrechen(job);
      this.stoerung(job, LLM.llmError('ETIMEDOUT', `Zeitüberschreitung nach ${this.W.timeout_s} s (Spielzeit)`), null);
    }
  }

  // ---------- Ergebnis
  messung(job, r) {
    const m = { dauer_s: job.wall ? (Date.now() - job.wall) / 1000 : null, tokens: r && r.tokens ? r.tokens : 0, key: r && r.key ? r.key : undefined };
    if (r && r.sec != null) m.dauer_s = r.sec;
    if (r && r.anbieter) { m.anbieter = r.anbieter; m.modell = r.modell || null; }
    return m;
  }
  planInfo(job, extra) { return Object.assign({ grenze: job.art, nr: job.nr, tick: this.game.weltsim ? this.game.weltsim.tickZahl : null, start_tick: job.startTick, sitzung: this.sitzung }, job.bau || {}, extra || {}); }
  // Störung: Eintrag ins Logbuch und Rückfall auf die Standard-KI (wartende Befehle und Überlagerung der Regie entfallen). Das Spiel merkt nichts.
  stoerung(job, e, r) {
    this.job = null; this.zustand = 'idle';
    this.zaehler.fehler++;
    const code = e && e.code ? e.code : 'EXIT';
    if (code === 'ENOENT') this.aus = 'CLI fehlt (' + (e && e.message) + ')';
    const m = this.messung(job, r || (e && e.anbieter ? { anbieter: e.anbieter, modell: e.modell } : null));
    this.schreibe(Object.assign({ ausgang: 'fehler', fehler: [code + ': ' + String((e && e.message) || e).slice(0, 250)], begruendung: `Grenze ${job.art}: Plan gescheitert, die Standard-KI läuft allein weiter`, plan: this.planInfo(job) }, m));
    try { Regie.rueckfall(this.game, `${code}: ${String((e && e.message) || e).slice(0, 120)}`); } catch (err) { this.fehlerZaehlen('lage-rueckfall', err); }
  }
  antwort(job, r) {
    const ws = this.game.weltsim;
    const gelesen = Prompt.planAusText(r && r.text);
    if (gelesen.fehler) return this.stoerung(job, LLM.llmError('EXIT', 'Antwort unbrauchbar: ' + gelesen.fehler), r);
    const alter = ws.tickZahl - job.startTick;
    if (alter > this.W.plan_alter_max_ticks) {
      // die Lage hat sich geändert: der Plan wird nie gespielt (kein Rückfall: frühere, geprüfte Pläne bleiben)
      this.zaehler.veraltet++;
      this.schreibe(Object.assign({ ausgang: 'veraltet', fehler: [`Plan ${alter} Ticks alt (höchstens ${this.W.plan_alter_max_ticks})`], begruendung: 'Plan zu spät, verworfen', plan: this.planInfo(job, { alter }) }, this.messung(job, r)));
      return;
    }
    const wh = Wiederholung.pruefen(gelesen.plan, this.verlauf, this.W);   // SUND-03 D: Wiederholungen fallen vor der Prüfung der Regie heraus (mit Grund im Logbuch)
    const res = Regie.planAnwenden(this.game, wh.plan);
    if (!res.ok) return this.stoerung(job, LLM.llmError('EXIT', 'Plan ungültig: ' + res.grund), r);
    this.zaehler.angewandt++;
    this.wiederholungenMelden(wh.abgelehnt);
    this.verlauf.push(Wiederholung.verlaufEintrag(wh.plan, res));
    while (this.verlauf.length > Math.max(1, this.W.wiederholung.fenster_plaene)) this.verlauf.shift();
    const kurz = { nr: job.nr, tick: ws.tickZahl, grenze: job.art, befehle: ergebnisse(res, wh, this.W.letzte_plaene_zeichen.grund), angenommen: res.angenommen.length, abgelehnt: res.abgelehnt.length + wh.abgelehnt.length,
      begruendung: typeof gelesen.plan.begruendung === 'string' ? gelesen.plan.begruendung.slice(0, 120) : null };
    if (gelesen.plan.fokus) kurz.fokus = String(gelesen.plan.fokus.hex || '');
    this.letzte_plaene.push(kurz);
    while (this.letzte_plaene.length > this.W.letzte_plaene) this.letzte_plaene.shift();
    if (kurz.angenommen === 0 && kurz.abgelehnt > 0) {
      // SUND-03 F: jeder Befehl des Plans scheiterte an Rate, Regeln oder Wiederholung: kein „angewandt“, sondern plan_wirkungslos mit Grund
      this.zaehler.wirkungslos++; this.zaehler.angewandt--;
      const gruende = res.abgelehnt.concat(wh.abgelehnt).map((a) => String(a.grund).slice(0, 120));
      this.schreibe(Object.assign({ ausgang: 'plan_wirkungslos', grund: gruende[0].split(':')[0], fehler: gruende.slice(0, 8), begruendung: 'Kein Befehl des Plans wurde angenommen (' + gruende[0].slice(0, 100) + ')', plan: this.planInfo(job, { angenommen: 0, abgelehnt: kurz.abgelehnt, alter }) }, this.messung(job, r)));
    } else this.schreibe(Object.assign({ ausgang: 'angewandt', begruendung: kurz.begruendung || 'Plan angewandt', plan: this.planInfo(job, { angenommen: kurz.angenommen, abgelehnt: kurz.abgelehnt, alter }) }, this.messung(job, r)));
    const typen = res.angenommen.map((a) => a.befehl.typ);
    Chronik.eintragen(this.game, { art: 'plan', ref: 'p' + job.nr, kurz: `Plan ${job.nr} (${job.art}): ${typen.length ? typen.join(', ') : 'nichts angenommen'}`, param: { angenommen: res.angenommen.length, abgelehnt: kurz.abgelehnt } });
  }
  // SUND-03 D: abgelehnte Wiederholungen ins Regie-Logbuch (wie die übrigen Ablehnungen des Aufsatzes: art lage_befehl, ausgang abgelehnt, Grund in fehler)
  wiederholungenMelden(abgelehnt) {
    for (const a of abgelehnt) Regie.schreibe(this.game, { art: 'lage_befehl', ausgang: 'abgelehnt', key: a.befehl.typ, plan: a.befehl, fehler: [a.grund] });
  }

  // ---------- Ende (Raumende, Neustart, Schalter aus): Anfrage in der Luft wird verworfen, späte Antworten kommen nie an
  dispose() {
    if (this.disposed) return;
    const inDerLuft = !!this.job;
    this.anfrageAbbrechen(this.job);
    this.disposed = true;
    this.job = null; this.zustand = 'idle'; this.inbox = [];
    if (inDerLuft && this.game.weltsim) { try { Regie.rueckfall(this.game, 'dispose mit Anfrage in der Luft'); } catch (e) { this.fehlerZaehlen('lage-dispose', e); } }
  }

  status() {
    const b = LLM.budget();
    return `Lage-Spielleiter: Modus ${this.mode}${this.aus ? ' (aus: ' + this.aus + ')' : ''}, Zustand ${this.zustand}, Anfragen ${this.aufrufe}/${this.W.deckel_je_sitzung}, `
      + `letzter Start Tick ${this.letzterStartTick == null ? '–' : this.letzterStartTick} (Abstand ${this.W.min_abstand_ticks}), angewandt ${this.zaehler.angewandt}, Fehler ${this.zaehler.fehler}, veraltet ${this.zaehler.veraltet}, `
      + `Tokens ${b.used}/${b.limit}, übersprungen ${JSON.stringify(this.zaehler.uebersprungen)}, letzte Pläne ${this.letzte_plaene.length}`;
  }
  // lage status | plan | fail
  debug(args) {
    const sub = String((args && args[0]) || 'status');
    if (sub === 'status') return this.status();
    if (sub === 'plan') { const r = this.planErzwingen(); return r.gestartet ? 'lage: Plan angefragt.' : 'lage: kein Plan (' + r.grund + ').'; }
    if (sub === 'fail') { this.failNext = true; return 'lage: die nächste Anfrage scheitert (Rückfall).'; }
    return 'lage: status | plan | fail';
  }
}

function create(game, opts) { return new LageSpielleiter(game, opts); }

module.exports = { create, LageSpielleiter, schalterAn, modusAusEnv, WERTE, kurzBefehl };
