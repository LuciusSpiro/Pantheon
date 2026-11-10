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
const Haken = require('../telemetrie/haken.js');   // TEL-01 B2: Wartezeit auf den Spielleiter ins Protokoll (liest nur)
const Regie = require('./regie-befehle.js');
const Kontingent = require('./kontingent.js');   // LIV-01: Schwelle des Token-Zählers (das Gate vor jeder Anfrage)
const Prompt = require('./lage-prompt.js');
const Wiederholung = require('./lage-wiederholung.js');   // SUND-03 D: Wiederholungsregeln der Pläne
const Chronik = require('./chronik.js');   // SUND-03 D: angewandte Pläne stehen in der Chronik
const Abenteuer = require('./abenteuer-spielleiter.js');   // SUND-04b A2: Komposition von Abenteuern (eigener Aufruf, nur mit FAEDEN=1)
const Stufen = require('../mission/stufen.js');   // SUND-04b A2

const DATEN = require('../../content/welt/lage-spielleiter-werte.json').werte;
const NOTBETRIEB = require('../../content/welt/notbetrieb-hinweis.json').werte;   // FRE-01 C: Texte und Gruende des Notbetrieb-Hinweises (eigene Datei: kein Teil des Tuning-Hashes)
const WERTE = Object.fromEntries(Object.entries(Object.assign({}, DATEN, NOTBETRIEB)).map(([k, v]) => [k, v.wert]));

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

// FRE-01 A: benannter Zustand 'rueckfall': der Lage-Spielleiter ist da (mode 'off'), stellt aber nie eine Modellanfrage und beauftragt keine Lage-Pläne
// (Standard-KI, Regie.rueckfall bleibt); Faden.spielleiterAktiv gilt dafür als wahr, damit Auftragsbrett, anschluss() und Angebote ohne Modell laufen.
// Erkannt am wirksamen Env: LAGE_SPIELLEITER=1 + SPIELLEITER_RUECKFALL=1 + kein Modell (SPIELLEITER_LLM unset oder off). Ohne SPIELLEITER_RUECKFALL gilt alles wie bisher.
function rueckfallAn(env) {
  const e = env || process.env;
  return String(e.LAGE_SPIELLEITER || '') === '1' && String(e.SPIELLEITER_RUECKFALL || '') === '1' && String(e.SPIELLEITER_LLM || 'off').toLowerCase() === 'off';
}
// Entsteht überhaupt ein Objekt (mit Modell oder im Rückfall)?
function betriebAn(env) { return schalterAn(env) || rueckfallAn(env); }

const kurzBefehl = (b) => {
  if (!b || typeof b !== 'object') return String(b).slice(0, 40);
  const t = [b.typ];
  for (const k of ['fraktion', 'an', 'gegen', 'ziel', 'sektor', 'ort', 'hex', 'flotte', 'vorlage', 'faden', 'beat']) if (b[k] !== undefined) t.push(b[k]);
  return t.join(' ').slice(0, 60);
};

// SUND-03 F: ein Befehl der letzten Pläne mit Ergebnis: "angreifen ger 0105: ok" | "embargo rom: abgelehnt (Rate: höchstens 8 …)". Der Plan-Fokus (ein Befehl je Fraktion) erscheint einmal.
function befehlErgebnis(b, grund, maxGrund) {
  const t = kurzBefehl(b);
  return grund == null ? t + ': ok' : t + ': abgelehnt (' + String(grund).replace(/\s+/g, ' ').slice(0, maxGrund) + ')';
}
function ergebnisse(res, wh, maxGrund) {
  // SUND-03 F2: der Plan-Fokus gilt für beide Reiche und erscheint als EIN Eintrag „fokus (beide) HEX“; geht er nur für eines durch (oder scheitert nur eines), stehen die Ergebnisse getrennt
  const out = [], fokus = { ok: [], nein: [] };
  for (const a of res.angenommen) { if (a.befehl.typ === 'fokus') fokus.ok.push(a.befehl); else out.push(befehlErgebnis(a.befehl, null, maxGrund)); }
  for (const a of res.abgelehnt.concat(wh.abgelehnt)) { if (a.befehl && a.befehl.typ === 'fokus') fokus.nein.push({ befehl: a.befehl, grund: a.grund }); else out.push(befehlErgebnis(a.befehl, a.grund, maxGrund)); }
  const label = (liste) => (liste.length >= 2 ? '(beide)' : liste[0].fraktion);
  const fokusText = (liste, grund) => {
    const b0 = liste[0].befehl || liste[0];
    const b = { typ: 'fokus', fraktion: label(liste.map((x) => x.befehl || x)), hex: b0.hex };
    return befehlErgebnis(b, grund, maxGrund);
  };
  if (fokus.ok.length) out.push(fokusText(fokus.ok, null));
  if (fokus.nein.length) out.push(fokusText(fokus.nein, fokus.nein[0].grund));
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
    this.rueckfallBetrieb = this.mode === 'off' && rueckfallAn(this.env);   // FRE-01 A: Brett und Faeden ohne Modell
    this.zustand = 'idle';
    this.job = null;
    this.seq = 0;
    this.inbox = [];
    this.aufrufe = 0;            // gestartete Anfragen dieser Sitzung (Deckel)
    this.letzterStartTick = null;
    this.letzte_plaene = [];     // Ringliste kurzer Pläne { nr, tick, grenze, befehle: [Text], angenommen, abgelehnt, begruendung }
    this.zaehler = { angewandt: 0, leer_begruendet: 0, leer_ohne_begruendung: 0, wirkungslos: 0, fehler: 0, veraltet: 0, uebersprungen: {} };
    this.failNext = false;
    this.aus = null;             // Grund, wenn der Transport für diese Sitzung aus ist (CLI fehlt)
    this.ausGemeldet = false;
    this.notbetriebFunkIn = null;      // FRE-01 Nacharbeit 2: Funk vorgemerkt, Restzeit in Spielsekunden (null = nichts vorgemerkt); Objekt-Zustand, nie im Weltstand
    this.notbetriebGemeldet = false;   // FRE-01 C: Hinweis "Notbetrieb" einmal je Sitzung (Objekt-Zustand, nie im Weltstand)
    this.startGeprueft = false;
    this.disposed = false;
    this.sitzung = (game.runId || ('lage-' + Date.now())) + '';
    this.abenteuer = Abenteuer.create(this, o.abenteuerWerte ? { werte: o.abenteuerWerte } : undefined);   // SUND-04b A2: tut ohne FAEDEN=1 nichts
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
        const create = { mode: this.mode, env: this.env, recordDir: path.join(this.opts.regieDir || require('../mission/regielog.js').dir(this.env), 'aufnahmen') };
        let router = this.opts.transport || null;
        if (!router && this.mode === 'live') router = require('../mission/transport-router.js').routerAusEnv(this.env);
        if (router) create.transport = router;
        this.llm = LLM.create(create);
        this.stufenMelden();
      } catch (e) { this.fehlerZaehlen('lage-llm', e); this.llm = LLM.create({ mode: 'off' }); }
    }
    return this.llm;
  }
  // SUND-04b A2: eine kaputte Stufendatei oder ein unbrauchbarer Wert der Umgebung (content/spielleiter/stufen.json): sichere Standardwerte gelten, EIN Eintrag je Sitzung im Regie-Logbuch. Ohne Fehler geschieht nichts.
  stufenMelden() {
    try {
      const fehler = Stufen.lade(this.env).fehler;
      if (fehler.length) Regie.schreibe(this.game, { art: 'stufen_konfig', quelle: 'regie', ausgang: 'fehler', fehler: fehler.slice(0, 6), begruendung: 'Stufen-Konfiguration fehlerhaft: sichere Standardwerte gelten' });
    } catch (e) { this.fehlerZaehlen('stufen-konfig', e); }
  }
  fehlerZaehlen(wo, e) { if (this.game.countError) this.game.countError(wo, e); }
  // FRE-01 C: eigener Fehler (kein Ausfall des Modells: Prompt, Plan, Antwort), meldet nie Notbetrieb
  lokalFehler(msg) { const e = LLM.llmError('EXIT', msg); e.lokal = true; return e; }
  // FRE-01 C: faellt das Modell im Live-Betrieb aus, merkt die Crew es EINMAL je Sitzung (Funk lage:1 + Zeile im Server-Log mit Grund). Nur im Betrieb live: im Rueckfall-Betrieb (absichtlich ohne
  // Modell) und bei mode off/mock kein Hinweis. Welche Gruende zaehlen, steht in den Daten (notbetrieb_gruende). Nichts blockiert, nichts wirft; das Regie-Logbuch schreiben die Ausfallstellen selbst.
  notbetriebMelden(grund, detail) {
    if (this.disposed || this.mode !== 'live' || this.rueckfallBetrieb || this.notbetriebGemeldet || this.notbetriebFunkIn !== null) return false;
    if (!this.W.notbetrieb_gruende.includes(grund)) return false;
    const T = this.W.notbetrieb_funk;
    const d = detail ? ': ' + String(detail).replace(/\s+/g, ' ').slice(0, 160) : '';
    try { this.game.log(T.log.replace('{grund}', grund).replace('{detail}', d)); } catch (e) { this.fehlerZaehlen('lage-notbetrieb-log', e); }
    // Der Funk folgt erst nach notbetrieb_verzoegerung_s Spielzeit (aus update): sonst ersetzt die Brett-Zeile "Neuer Auftrag" im selben Tick die Lagemeldung auf dem Schirm.
    // Vorgemerkt ist sofort (weitere Ausfaelle melden nicht erneut), gemeldet erst beim Senden.
    const v = Number(this.W.notbetrieb_verzoegerung_s);
    this.notbetriebFunkIn = Number.isFinite(v) && v > 0 ? v : 0;
    return true;
  }
  // Funk "Notbetrieb" nach Ablauf der Verzoegerung senden (aus update); nach dispose nicht mehr
  notbetriebFunkTakt(dt) {
    if (this.notbetriebFunkIn === null || this.disposed) return;
    this.notbetriebFunkIn -= Number(dt) > 0 ? Number(dt) : 0;
    if (this.notbetriebFunkIn > 0) return;
    this.notbetriebFunkIn = null; this.notbetriebGemeldet = true;
    const T = this.W.notbetrieb_funk;
    try { this.game.emit('radio', { from: T.sprecher, text: T.text, lage: 1, r: 1 }); } catch (e) { this.fehlerZaehlen('lage-notbetrieb', e); }
  }
  // aus einem Fehlerobjekt des Transports: eigene Fehler (lokal) und Codes ausserhalb der Liste melden nicht
  notbetriebBeiFehler(e) { return this.notbetriebMelden(e && e.lokal ? 'lokal' : ((e && e.code) || 'EXIT'), e && e.message); }
  // Beim ersten update im Live-Betrieb: ist keine Claude-CLI zu finden, sofort melden (nicht erst beim ersten Plan). Ohne Modellaufruf. Mit eingehaengtem Transport/Modell (Tests) nur mit opts.cliFinden.
  startPruefen() {
    if (this.startGeprueft) return;
    this.startGeprueft = true;
    if (this.mode !== 'live' || this.rueckfallBetrieb || this.llm || (this.opts.transport && !this.opts.cliFinden)) return;
    try {
      const f = (this.opts.cliFinden || LLM.claudeFinden)({ env: this.env });
      if (!f || !f.cmd) { this.aus = this.aus || 'CLI fehlt (beim Start gesucht)'; this.notbetriebMelden('cli_fehlt', 'versucht: ' + ((f && f.versucht) || []).join(', ')); }
    } catch (e) { this.fehlerZaehlen('lage-cli-pruefung', e); }
  }
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
    const r = this.planGrenze(art);
    try { this.abenteuer.beiGrenze(art); } catch (e) { this.fehlerZaehlen('abenteuer-grenze', e); }   // SUND-04b A2: eigener Takt, unabhaengig vom Plan der Lage; wirft nie in den Hook
    return r;
  }
  planGrenze(art) {
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
    if (this.rueckfallBetrieb) return { gestartet: false, grund: 'rueckfall' };   // FRE-01 A: kein Lage-Plan, kein Modell, kein Logbuch-Rauschen
    if (this.mode === 'off' || (this.llm && this.llm.mode === 'off')) {
      if (!this.ausGemeldet) { this.ausGemeldet = true; Regie.rueckfall(this.game, 'Lage-Spielleiter aus (Modus off)'); }
      if (this.mode === 'live') this.notbetriebMelden('OFF', 'Modell nicht verfügbar (Modus off im Live-Betrieb)');
      return { gestartet: false, grund: 'aus' };
    }
    if (this.aus) return this.ueberspringen('transport_aus', art);
    if (this.zustand !== 'idle') return this.ueberspringen('beschaeftigt', art);
    // SUND-03 F2: Rate erschöpft: jeder Befehl scheiterte an der Rate, der Aufruf wäre zwecklos (kein Claude-Aufruf, zählt nicht gegen den Deckel)
    if (Regie.befehleFrei(this.game).rate === 0) return this.ueberspringen('rate', art);
    const b = LLM.budget();
    if (Kontingent.sperrt(this.game, this.W.min_budget)) {   // LIV-01: die Schwelle ist das Gate (kontingent.js), min_budget nur gedeckelt
      // Rückfall und Logbuch nur EINMAL je Zustand „Budget leer“; jede weitere Grenze wird nur übersprungen und rührt die Regie nicht neu an
      if (this.budgetGemeldet) return this.ueberspringen('budget', art);
      this.budgetGemeldet = true;
      Regie.rueckfall(this.game, Kontingent.erreicht() ? `Kontingent erreicht (${b.used} von ${b.limit}, Schwelle ${Kontingent.schwelle()})` : `Token-Budget fast leer (${b.used} von ${b.limit}, Rest < ${Kontingent.mindestRest(this.W.min_budget)})`);
      this.schreibe({ ausgang: 'fehler', grund: 'budget', fehler: ['BUDGET'], budget: { used: b.used, limit: b.limit }, begruendung: 'Grenze ' + art + ': Budget leer', plan: { grenze: art, tick: ws.tickZahl, sitzung: this.sitzung } });
      this.zaehler.fehler++;
      this.notbetriebMelden('BUDGET', `Token-Budget fast leer (${b.used} von ${b.limit})`);
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
    this.notbetriebFunkTakt(dt);
    this.startPruefen();
    this.abholen();
    this.fristPruefen();
    if (this.zustand === 'angefragt') this.starten();
    try { this.abenteuer.update(dt); } catch (e) { this.fehlerZaehlen('abenteuer-update', e); }   // SUND-04b A2
  }
  starten() {
    const job = this.job;
    if (!job) { this.zustand = 'idle'; return; }
    if (this.failNext) { this.failNext = false; return this.stoerung(job, this.lokalFehler('Debug: lage fail'), null); }
    let bau;
    try { bau = Prompt.baue(this.game, { art: job.art, nr: job.nr, letzte: this.letzte_plaene, werte: this.W }); } catch (e) { this.fehlerZaehlen('lage-prompt', e); return this.stoerung(job, this.lokalFehler('Prompt nicht baubar: ' + e.message), null); }
    if (bau.fehler) return this.stoerung(job, this.lokalFehler(bau.fehler), null);
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
      Haken.spielleiterWarten(this.game, 'lage', this.game.time - job.start, Haken.warteAusgang(it.e));   // TEL-01 B2: Anfrage -> Antwort (liest nur)
      if (it.e) this.stoerung(job, it.e, null);
      else { try { this.antwort(job, it.r); } catch (e) { this.fehlerZaehlen('lage-antwort', e); this.stoerung(job, this.lokalFehler('Plan nicht anwendbar: ' + e.message), it.r); } }
    }
  }
  // Beendet den Transport der Anfrage (AbortSignal an llm.ask → CLI-Prozess bzw. Ollama-Aufruf)
  anfrageAbbrechen(job) { if (job && job.abbruch) { try { job.abbruch.abort(); } catch (e) { this.fehlerZaehlen('lage-abort', e); } } }
  fristPruefen() {
    const job = this.job;
    if (!job || this.zustand !== 'laeuft') return;
    if (this.game.time - job.start > this.W.timeout_s + 1) {
      this.job = null; this.zustand = 'idle';
      Haken.spielleiterWarten(this.game, 'lage', this.game.time - job.start, 'timeout');   // TEL-01 B2
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
  planInfo(job, extra) { return Object.assign(this.cli ? { cli: this.cli } : {}, { grenze: job.art, nr: job.nr, tick: this.game.weltsim ? this.game.weltsim.tickZahl : null, start_tick: job.startTick, sitzung: this.sitzung }, job.bau || {}, extra || {}); }
  // Störung: Eintrag ins Logbuch und Rückfall auf die Standard-KI (wartende Befehle und Überlagerung der Regie entfallen). Das Spiel merkt nichts.
  stoerung(job, e, r) {
    this.job = null; this.zustand = 'idle';
    this.zaehler.fehler++;
    const code = e && e.code ? e.code : 'EXIT';
    if (code === 'ENOENT') this.aus = 'CLI fehlt (' + (e && e.message) + ')';
    const m = this.messung(job, r || (e && e.anbieter ? { anbieter: e.anbieter, modell: e.modell } : null));
    this.schreibe(Object.assign({ ausgang: 'fehler', fehler: [code + ': ' + String((e && e.message) || e).slice(0, 250)], begruendung: `Grenze ${job.art}: Plan gescheitert, die Standard-KI läuft allein weiter`, plan: this.planInfo(job) }, m));
    try { Regie.rueckfall(this.game, `${code}: ${String((e && e.message) || e).slice(0, 120)}`); } catch (err) { this.fehlerZaehlen('lage-rueckfall', err); }
    this.notbetriebBeiFehler(e);   // FRE-01 C: nur Ausfaelle des Modells (Daten notbetrieb_gruende), nie eigene Fehler
  }
  antwort(job, r) {
    const ws = this.game.weltsim;
    if (r && r.cli) this.cli = r.cli;   // welche CLI lief, mit Hinweis bei falsch gesetztem CLAUDE_CLI (im Logbuch unter plan.cli und in status)
    const gelesen = Prompt.planAusText(r && r.text);
    if (gelesen.fehler) return this.stoerung(job, this.lokalFehler('Antwort unbrauchbar: ' + gelesen.fehler), r);
    const alter = ws.tickZahl - job.startTick;
    if (alter > this.W.plan_alter_max_ticks) {
      // die Lage hat sich geändert: der Plan wird nie gespielt (kein Rückfall: frühere, geprüfte Pläne bleiben)
      this.zaehler.veraltet++;
      this.schreibe(Object.assign({ ausgang: 'veraltet', fehler: [`Plan ${alter} Ticks alt (höchstens ${this.W.plan_alter_max_ticks})`], begruendung: 'Plan zu spät, verworfen', plan: this.planInfo(job, { alter }) }, this.messung(job, r)));
      return;
    }
    const wh = Wiederholung.pruefen(gelesen.plan, this.verlauf, this.W);   // SUND-03 D: Wiederholungen fallen vor der Prüfung der Regie heraus (mit Grund im Logbuch)
    const res = Regie.planAnwenden(this.game, wh.plan);
    if (!res.ok) return this.stoerung(job, this.lokalFehler('Plan ungültig: ' + res.grund), r);
    this.zaehler.angewandt++;
    this.wiederholungenMelden(wh.abgelehnt);
    this.verlauf.push(Wiederholung.verlaufEintrag(wh.plan, res));
    while (this.verlauf.length > Math.max(1, this.W.wiederholung.fenster_plaene)) this.verlauf.shift();
    const kurz = { nr: job.nr, tick: ws.tickZahl, grenze: job.art, befehle: ergebnisse(res, wh, this.W.letzte_plaene_zeichen.grund), angenommen: res.angenommen.filter((a) => a.platz && !(a.befehl && /^faden_/.test(a.befehl.typ || ''))).length, abgelehnt: res.abgelehnt.length + wh.abgelehnt.length,   // angenommen = gebuchte Rate-Plätze (der Plan-Fokus für beide Reiche zählt einen; Faden-Befehle (faden_*) zählen nie, sie stehen nicht gegen die Rate)
     
      begruendung: typeof gelesen.plan.begruendung === 'string' ? gelesen.plan.begruendung.slice(0, 120) : null };
    if (gelesen.plan.fokus) kurz.fokus = String(gelesen.plan.fokus.hex || '');
    this.letzte_plaene.push(kurz);
    while (this.letzte_plaene.length > this.W.letzte_plaene) this.letzte_plaene.shift();
    if (kurz.angenommen === 0 && kurz.abgelehnt > 0) {
      // SUND-03 F: jeder Befehl des Plans scheiterte an Rate, Regeln oder Wiederholung: kein „angewandt“, sondern plan_wirkungslos mit Grund
      this.zaehler.wirkungslos++; this.zaehler.angewandt--;
      const gruende = res.abgelehnt.concat(wh.abgelehnt).map((a) => String(a.grund).slice(0, 120));
      this.schreibe(Object.assign({ ausgang: 'plan_wirkungslos', grund: gruende[0].split(':')[0], fehler: gruende.slice(0, 8), begruendung: 'Kein Befehl des Plans wurde angenommen (' + gruende[0].slice(0, 100) + ')', plan: this.planInfo(job, { angenommen: 0, abgelehnt: kurz.abgelehnt, alter }) }, this.messung(job, r)));
    } else {
      // SUND-03 F2: ein Plan ohne jeden Befehl und Fokus ist „leer“: begründet (Lage ruhig, Rate erschöpft …) oder ohne Begründung, getrennt gezählt und im Feld grund ausgewiesen
      const leer = !(gelesen.plan.befehle || []).length && !gelesen.plan.fokus;
      const leerArt = leer ? (typeof gelesen.plan.begruendung === 'string' && gelesen.plan.begruendung.trim().length >= 5 ? 'leer_begruendet' : 'leer_ohne_begruendung') : null;
      if (leerArt) this.zaehler[leerArt]++;
      this.schreibe(Object.assign({ ausgang: 'angewandt', begruendung: kurz.begruendung || 'Plan angewandt', plan: this.planInfo(job, { angenommen: kurz.angenommen, abgelehnt: kurz.abgelehnt, alter }) }, leerArt ? { grund: leerArt } : {}, this.messung(job, r)));
    }
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
    this.notbetriebFunkIn = null;   // vorgemerkter Notbetrieb-Funk verfaellt mit der Sitzung
    const inDerLuft = !!this.job;
    this.anfrageAbbrechen(this.job);
    try { this.abenteuer.dispose(); } catch (e) { this.fehlerZaehlen('abenteuer-dispose', e); }
    this.disposed = true;
    this.job = null; this.zustand = 'idle'; this.inbox = [];
    if (inDerLuft && this.game.weltsim) { try { Regie.rueckfall(this.game, 'dispose mit Anfrage in der Luft'); } catch (e) { this.fehlerZaehlen('lage-dispose', e); } }
  }

  status() {
    const b = LLM.budget();
    return `Lage-Spielleiter: Modus ${this.mode}${this.aus ? ' (aus: ' + this.aus + ')' : ''}${this.cli ? ', CLI ' + this.cli.quelle + (this.cli.hinweis ? ' [' + this.cli.hinweis + ']' : '') : ''}, Zustand ${this.zustand}, Anfragen ${this.aufrufe}/${this.W.deckel_je_sitzung}, `
      + `letzter Start Tick ${this.letzterStartTick == null ? '–' : this.letzterStartTick} (Abstand ${this.W.min_abstand_ticks}), angewandt ${this.zaehler.angewandt} (davon leer begründet ${this.zaehler.leer_begruendet}, leer ohne Begründung ${this.zaehler.leer_ohne_begruendung}), wirkungslos ${this.zaehler.wirkungslos}, Fehler ${this.zaehler.fehler}, veraltet ${this.zaehler.veraltet}, `
      + `Tokens ${b.used}/${b.limit}, übersprungen ${JSON.stringify(this.zaehler.uebersprungen)}, letzte Pläne ${this.letzte_plaene.length}`;
  }
  // lage status | plan | fail
  debug(args) {
    const sub = String((args && args[0]) || 'status');
    if (sub === 'status') return this.status();
    if (sub === 'plan') { const r = this.planErzwingen(); return r.gestartet ? 'lage: Plan angefragt.' : 'lage: kein Plan (' + r.grund + ').'; }
    if (sub === 'fail') { this.failNext = true; return 'lage: die nächste Anfrage scheitert (Rückfall).'; }
    if (sub === 'abenteuer') { const r = String(args[1] || 'status'); if (r === 'plan') { const x = this.abenteuer.erzwingen(); return x.gestartet ? 'lage: Abenteuer-Aufruf angefragt.' : 'lage: kein Abenteuer-Aufruf (' + x.grund + ').'; } return this.abenteuer.status(); }   // SUND-04b A2
    return 'lage: status | plan | fail | abenteuer [status | plan]';
  }
}

function create(game, opts) { return new LageSpielleiter(game, opts); }

module.exports = { create, LageSpielleiter, schalterAn, rueckfallAn, betriebAn, modusAusEnv, WERTE, kurzBefehl };
