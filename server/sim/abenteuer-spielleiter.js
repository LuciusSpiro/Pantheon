'use strict';
// SUND-04b A2: Komposition von Abenteuern durch den Spielleiter (Freie Fahrt Sund, nur mit FAEDEN=1 und dem Lage-Spielleiter LAGE_SPIELLEITER=1). Eigener Aufruf (kind abenteuer, Stufe bauplan,
// Systemprompt content/spielleiter/prompts/abenteuer.system.md), NICHT der Takt-Prompt der Lage. Muster des Lage-Spielleiters: Ein-Job-Zustand, die Antwort kommt asynchron und wird im naechsten update(dt)
// zwischen den Ticks abgeholt, eine spaete Antwort wird verworfen. Das Spiel wartet NIE auf ihn; er fuehrt nie zu einem Rueckfall der Standard-KI der Lage.
//
// Ablauf: Grenze (szene_ende | andocken | absicht, Hook game.lageGrenze ueber LageSpielleiter.beiGrenze) -> weniger als angebote_max offene Abenteuer-Angebote, kein Cooldown, Deckel nicht erschoepft, ein Ort,
// kein anderer Aufruf unterwegs -> EIN Aufruf -> Antwort (Bauplan-JSON) -> Groessengrenze und Lesen -> Faden.abenteuerAnbieten (expandiert, derselbe Pruefer, hoechstens 3 Angebote) -> Angebot.
// Antwort ungueltig oder Anbieter ausgefallen: kein Angebot, Eintrag im Regie-Logbuch, nichts blockiert, nie ein Absturz. Ist die Stufe bauplan bei Ollama und hat eskalation: true (stufen.json), geht eine
// ausgefallene oder abgelehnte Anfrage EINMAL an Claude.
//
// SPL-02 E1: Betriebsmodus Absichten (abenteuer-absicht.js, Schalter ABENTEUER_ABSICHTEN, Standard aus: dann bleibt alles wie oben, byte-gleich). Prompt: Absichten statt Beat-Typen (abenteuer-prompt.js baueAbsicht), Antwort: eine
// Absicht (absicht/1) > Kennungen des Prompts (am Job eingefroren) > Pruefer > Inszenierer > Brett.neuAnbieten. Ein Nein der Welt geht in EINE Verhandlungsrunde (zweiter kleiner Aufruf, zaehlt als Aufruf des Deckels und geht
// durch das Budget-Gate); danach: kein Angebot (ausgang abgelehnt, grund = Code), der Rueckfall des Bretts greift wie sonst. Logbuch: zusaetzlich modus, absicht, bezug_art, verhandlung (nie Titel, Texte oder NSC-Namen);
// tokens, geld und dauer_s summieren beide Aufrufe.
// Logbuch (art abenteuer_bauplan, tools/regie-bericht.js): je Aufruf ausgang gueltig | abgelehnt (grund = Code des Pruefers, ANTWORT_LEER | ANTWORT_ZU_GROSS | ANTWORT_UNLESBAR) | ausfall (grund = Fehlercode des
// Transports) | verspaetet | uebersprungen; dazu anbieter, modell, tokens, dauer_s, geld (USD, 0 bei Mock und Ollama), eskaliert, plan { grenze, nr, sitzung, hex, typen, ... }. Titel und Anlass stehen nie im Eintrag.
//   const sl = create(lage)    sl.beiGrenze(art) -> { gestartet, grund } | null    sl.update(dt)    sl.dispose()    sl.status()    sl.erzwingen()  (Debug: ohne Cooldown und Deckel)
const LLM = require('../mission/llm.js');
const Haken = require('../telemetrie/haken.js');   // TEL-01 B2: Wartezeit auf den Spielleiter ins Protokoll (liest nur)
const Regie = require('./regie-befehle.js');
const Kontingent = require('./kontingent.js');   // LIV-01: Schwelle des Token-Zählers
const Prompt = require('./abenteuer-prompt.js');
const Ziel = require('./abenteuer-ziel.js');   // FRE-02 A1: Zielwahl im Umkreis des Hafens
const Absicht = require('./abenteuer-absicht.js');   // SPL-02 E1: Betriebsmodus Absichten (Schalter ABENTEUER_ABSICHTEN)
const { WERTE } = require('./abenteuer-daten.js');

const faden = () => require('./faden.js');   // lazy: faden.js laedt das Regie-Modul
const STUFE = 'bauplan';
const codeVon = (t) => String(t).split(':')[0];
// Ablehnungen, die nicht am Modell liegen (Zustand des Fadens, Ort): eine Eskalation an Claude wuerde nur einen zweiten Aufruf bezahlen, ohne dass sich etwas aendert
const NICHT_MODELL = ['ABENTEUER_DOPPELT', 'ABENTEUER_ANGEBOTE', 'INAKTIV', 'PARAMETER', 'WIEDERHOLUNG_ORT', 'WIEDERHOLUNG_NSC'];   // SUND-04b E3: Ort und Hauptfigur wählt nicht das Modell

class AbenteuerSpielleiter {
  constructor(lage, opts) {
    const o = opts || {};
    this.lage = lage;
    this.game = lage.game;
    this.W = Object.assign({}, WERTE, o.werte || {});
    this.zustand = 'idle';       // 'idle' | 'angefragt' (Prompt wird im naechsten update gebaut) | 'laeuft'
    this.job = null;             // { token, art, nr, hex (Ort der Geschichte), herkunftHex (Hafen/Crew, FRE-02 A1), start (Spielzeit), wall, bau, eskaliert, input }
    this.seq = 0;
    this.inbox = [];
    this.aufrufe = 0;            // gestartete Aufrufe dieser Sitzung (Deckel)
    this.grenzenSeit = Infinity; // Taetigkeitsgrenzen seit dem letzten Start (Cooldown)
    this.letzte = [];            // { nr, typen } der zuletzt angebotenen Abenteuer (Kontext des naechsten Aufrufs)
    this.zaehler = { gueltig: 0, abgelehnt: {}, ausfall: 0, verspaetet: 0, uebersprungen: {}, eskaliert: 0 };
    this.aus = null;             // Grund, wenn der Transport fuer diese Sitzung aus ist (CLI fehlt)
    this.eskalationAus = null;   // Grund, wenn nur die Eskalation an Claude aus ist (CLI fehlt, der eigentliche Anbieter ist Ollama)
    this.letzterSprung = null;
    this.disposed = false;
  }

  // ---------- Hilfen
  bereit() { return !this.disposed && !!this.game.weltsim && faden().aktiv(this.game); }
  modusAus() { const l = this.lage; return l.mode === 'off' || (l.llm && l.llm.mode === 'off'); }
  schreibe(eintrag) { Regie.schreibe(this.game, Object.assign({ art: 'abenteuer_bauplan', quelle: this.lage.mode === 'mock' || this.lage.mode === 'script' ? 'mock' : 'llm' }, eintrag)); }
  fehlerZaehlen(wo, e) { if (this.game.countError) this.game.countError(wo, e); }
  crewHex() {
    try {
      const g = this.game;
      const hex = g.ship && g.ship.scene ? require('./marken.js').hexVon(g.ship.scene) : null;
      return hex && require('../../shared/sektoren.js').spielbar(hex) ? hex : null;
    } catch (e) { return null; }
  }
  offeneAngebote() { const F = faden().zustandVon(this.game); return F ? F.abenteuerAngebote.length : 0; }
  // Uebersprungen: gezaehlt immer, im Logbuch nur beim Wechsel des Grundes (keine Flut)
  ueberspringen(grund, art) {
    this.zaehler.uebersprungen[grund] = (this.zaehler.uebersprungen[grund] || 0) + 1;
    if (this.letzterSprung !== grund) {
      this.letzterSprung = grund;
      this.schreibe({ ausgang: 'uebersprungen', grund, begruendung: `Grenze ${art}: kein Abenteuer-Aufruf (${grund})`, plan: { grenze: art, sitzung: this.lage.sitzung, aufrufe: this.aufrufe } });
    }
    return { gestartet: false, grund };
  }

  // ---------- Grenze: nur pruefen und vormerken, nichts Schweres (der Aufruf kommt aus einem Hook mitten im Spiel)
  beiGrenze(art) {
    if (!this.bereit()) return null;                                   // ohne FAEDEN=1 oder nach dispose: nichts, auch kein Logbuch
    if (!this.W.grenzen.includes(art)) return null;
    if (this.modusAus()) return null;                                      // Modus off: der Lage-Spielleiter meldet das selbst, hier bleibt es still
    this.grenzenSeit++;
    const regel = this.taktErlaubt(art);
    return regel || this.vormerken(art);
  }
  taktErlaubt(art) {
    if (this.aus) return this.ueberspringen('transport_aus', art);
    if (this.zustand !== 'idle') return this.ueberspringen('beschaeftigt', art);
    // Der Lage-Plan startet an derselben Grenze (vor uns): nie zwei Prozesse zugleich. Zaehlt weder als Aufruf (Deckel) noch setzt es den Cooldown zurueck.
    if (this.lage.zustand !== 'idle') return this.ueberspringen('lage_beschaeftigt', art);
    if (this.aufrufe >= this.W.deckel_je_sitzung) return this.ueberspringen('deckel', art);
    if (this.offeneAngebote() >= angeboteMax()) return this.ueberspringen('angebote_voll', art);
    if (this.aufrufe > 0 && this.grenzenSeit < this.W.cooldown_grenzen) return this.ueberspringen('cooldown', art);
    return null;
  }
  // Debug und Messung: ohne Cooldown und Deckel (Obergrenzen der Angebote und ein Job zugleich gelten weiter)
  erzwingen() {
    if (!this.bereit()) return { gestartet: false, grund: 'dispose' };
    if (this.modusAus()) return { gestartet: false, grund: 'aus' };
    if (this.zustand !== 'idle') return this.ueberspringen('beschaeftigt', 'debug');
    if (this.offeneAngebote() >= angeboteMax()) return this.ueberspringen('angebote_voll', 'debug');
    return this.vormerken('debug');
  }
  // Budget: nur eine Stufe bei Claude zaehlt gegen den Token-Zaehler (CLAUDE_TOKEN_BUDGET); LIV-01: Schwelle als Gate (kontingent.js)
  budgetGesperrt() {
    const llm = this.lage.getLlm();
    return llm.mode === 'live' && llm.anbieterFuer('abenteuer', STUFE) !== 'ollama' && Kontingent.sperrt(this.game, this.W.min_budget);
  }
  vormerken(art) {
    const hafen = this.crewHex();   // FRE-02 A1: Herkunft (beim Andocken der Hafen); der Ort der Geschichte ist ein Ziel in der Umgebung (abenteuer-ziel.js), im Modus Absichten bis A2 weiter der Ort der Crew
    const ort = hafen && !Absicht.aktiv(this.game) ? Ziel.zielImUmkreis(this.game, hafen, { belegt: Ziel.belegt(this.game) }) : hafen;
    if (!ort) return this.ueberspringen('kein_ort', art);
    if (this.budgetGesperrt()) return this.ueberspringen('budget', art);   // LIV-01: Schwelle als Gate (kontingent.js); LIV-02: Kontingent-Ende meldet keinen Notbetrieb
    this.letzterSprung = null;
    this.aufrufe++;
    this.grenzenSeit = 0;
    this.zustand = 'angefragt';
    this.job = { token: 0, art, nr: this.aufrufe, hex: ort, herkunftHex: hafen, start: this.game.time, wall: null, bau: null, eskaliert: false, input: null };
    return { gestartet: true, grund: null };
  }

  // ---------- Tick-Pfad (zwischen den Ticks)
  update(dt) {
    if (this.disposed || !this.game.weltsim) return;
    this.abholen();
    this.fristPruefen();
    if (this.zustand === 'angefragt') this.starten();
    if (this.bereit()) { try { require('./abenteuer-brett.js').beiUpdate(this.game); } catch (e) { this.fehlerZaehlen('abenteuer-brett-update', e); } }   // SUND-04b C: Anschluss-Garantie im Takt (Spielstart, Laden; ohne Angebot und ohne laufendes Abenteuer)
  }
  starten() {
    const job = this.job;
    if (!job) { this.zustand = 'idle'; return; }
    let bau;
    const modus = Absicht.aktiv(this.game);   // SPL-02 E1
    try { bau = modus ? Absicht.baue(this.game, { nr: job.nr, grenze: job.art, hex: job.hex, letzteAbsichten: this.letzte.map((x) => x.absicht).filter(Boolean), werte: this.W }) : Prompt.baue(this.game, { nr: job.nr, grenze: job.art, hex: job.hex, letzte: this.letzte, werte: this.W }); } catch (e) { this.fehlerZaehlen('abenteuer-prompt', e); return this.ausfall(job, this.lage.lokalFehler('Prompt nicht baubar: ' + e.message), null); }
    if (bau.fehler) return this.ausfall(job, this.lage.lokalFehler(bau.fehler), null);
    job.bau = { prompt_zeichen: bau.zeichen, kontext_zeichen: bau.kontextZeichen };
    job.input = { system: modus ? Absicht.SYSTEM_DATEI : Prompt.SYSTEM_DATEI, prompt: bau.prompt, art: 'abenteuer', nr: job.nr };
    if (modus) { job.modus = 'absicht'; job.kennungen = bau.kennungen; job.bau.katalog_zeichen = bau.katalogZeichen; }   // kennungen: die DIESES Prompts, nicht die des Zustands zur Antwortzeit
    this.losschicken(job, false);
  }
  // ein Aufruf in der Luft: normal oder (eskaliert) an den Eskalations-Anbieter
  losschicken(job, eskalation) {
    job.token = ++this.seq; job.start = this.game.time; job.wall = Date.now(); job.eskaliert = eskalation;
    this.zustand = 'laeuft';
    job.abbruch = new AbortController();   // dispose und Frist beenden den Transport (CLI-Prozess bzw. Ollama-Aufruf)
    const ao = { timeoutMs: 1000 * this.W.timeout_s, signal: job.abbruch.signal, stufe: STUFE };
    let p;
    try { const llm = this.lage.getLlm(); p = eskalation ? llm.eskaliere('abenteuer', job.input, ao) : llm.ask('abenteuer', job.input, ao); } catch (e) { p = Promise.reject(e); }
    const token = job.token;
    Promise.resolve(p).then((r) => { if (!this.disposed) this.inbox.push({ token, r }); }, (e) => { if (!this.disposed) this.inbox.push({ token, e }); });
  }
  abholen() {
    while (this.inbox.length) {
      const it = this.inbox.shift();
      const job = this.job;
      if (!job || job.token !== it.token) {
        // spaete Antwort (Frist schon behandelt): verworfen, nur die Tokens stehen im Logbuch. Ein eigener Abbruch (ABORTED) ist keine spaete Antwort.
        if (it.e && it.e.code === 'ABORTED') continue;
        this.zaehler.verspaetet++;
        this.schreibe(Object.assign({ ausgang: 'verspaetet', begruendung: 'Antwort nach Zeitueberschreitung verworfen', plan: { sitzung: this.lage.sitzung } }, it.r ? this.messung(null, it.r) : {}));
        continue;
      }
      Haken.spielleiterWarten(this.game, 'abenteuer', this.game.time - job.start, Haken.warteAusgang(it.e));   // TEL-01 B2: Anfrage -> Antwort (liest nur)
      if (it.e) this.ausfall(job, it.e, null);
      else { try { this.antwort(job, it.r); } catch (e) { this.fehlerZaehlen('abenteuer-antwort', e); this.ausfall(job, this.lage.lokalFehler('Antwort nicht verarbeitbar: ' + e.message), it.r); } }
    }
  }
  fristPruefen() {
    const job = this.job;
    if (!job || this.zustand !== 'laeuft') return;
    if (this.game.time - job.start > this.W.timeout_s + 1) {
      Haken.spielleiterWarten(this.game, 'abenteuer', this.game.time - job.start, 'timeout');   // TEL-01 B2
      this.abbrechen(job);
      this.ausfall(job, LLM.llmError('ETIMEDOUT', `Zeitueberschreitung nach ${this.W.timeout_s} s (Spielzeit)`), null);
    }
  }
  abbrechen(job) { if (job && job.abbruch) { try { job.abbruch.abort(); } catch (e) { this.fehlerZaehlen('abenteuer-abort', e); } } }

  // ---------- Ergebnis
  messung(job, r, e) {
    const llm = this.lage.llm;
    const live = llm && llm.mode === 'live';
    const m = { dauer_s: r && r.sec != null ? r.sec : (job && job.wall ? (Date.now() - job.wall) / 1000 : null), tokens: r && r.tokens ? r.tokens : 0 };
    m.anbieter = (r && r.anbieter) || (e && e.anbieter) || (r && r.source === 'live' ? 'claude' : (live ? ((llm.anbieterFuer && llm.anbieterFuer('abenteuer', STUFE)) || 'claude') : 'mock'));
    m.modell = (r && (r.modell || r.modelId)) || (e && e.modell) || (live ? null : 'mock');
    m.geld = r && Number.isFinite(Number(r.cost)) ? Number(r.cost) : (m.anbieter === 'ollama' || !live ? 0 : null);
    if (r && r.eskaliert) m.eskaliert = true; else if (job && job.eskaliert) m.eskaliert = true;
    const v = job && job.vorkosten;   // SPL-02 E1: der erste Aufruf einer Verhandlung zaehlt mit
    if (v) { m.tokens += v.tokens || 0; m.geld = Number.isFinite(m.geld) && Number.isFinite(v.geld) ? m.geld + v.geld : null; if (Number.isFinite(m.dauer_s) && Number.isFinite(v.dauer_s)) m.dauer_s += v.dauer_s; if (v.eskaliert) m.eskaliert = true; }
    return m;
  }
  // SPL-02 E1: zusaetzliche Felder der Eintraege im Modus Absichten (leer im Standard: Eintraege bleiben byte-gleich)
  absichtFelder(job) { return job && job.modus ? { modus: job.modus, absicht: job.absichtName || null, bezug_art: job.bezugArt || null, verhandlung: job.runde ? 1 : 0 } : {}; }
  planInfo(job, extra) { return Object.assign({ grenze: job.art, nr: job.nr, hex: job.hex, sitzung: this.lage.sitzung }, job.bau || {}, extra || {}); }
  // Eskalation: nur wenn der Router sie fuer diese Stufe erlaubt (Stufe bei Ollama, eskalation: true), nie fuer einen eigenen Abbruch, nur einmal je Aufruf
  eskalieren(job, grund) {
    const llm = this.lage.llm;
    if (this.job !== job || this.eskalationAus || job.eskaliert || !job.input || !llm || typeof llm.eskalationMoeglich !== 'function' || !llm.eskalationMoeglich('abenteuer', STUFE)) return false;
    if (Kontingent.sperrtEskalation(this.game, this.W.min_budget)) return false;   // LIV-01: die Eskalation geht an Claude und zaehlt gegen den Zaehler: ab der Schwelle nie (kein Ausweg am Gate in vormerken vorbei)
    this.zaehler.eskaliert++;
    this.schreibe(Object.assign({ ausgang: 'eskaliert', grund, begruendung: 'Anfrage geht einmal an Claude (Stufe bauplan, eskalation: true)', plan: this.planInfo(job) }, this.absichtFelder(job)));
    this.losschicken(job, true);
    return true;
  }
  // Ausfall des Anbieters (Fehler, Frist, Prompt): kein Angebot, Eintrag, nichts blockiert. Kein Rueckfall der Standard-KI (das betrifft nur den Plan der Lage).
  ausfall(job, e, r) {
    if (this.job !== job) return;   // veralteter Job (Frist, Neustart, dispose): nichts mehr anfassen
    const code = e && e.code ? e.code : 'EXIT';
    if (code !== 'ABORTED' && this.eskalieren(job, code)) return;   // ein Abbruch eskaliert nie
    this.job = null; this.zustand = 'idle';
    this.zaehler.ausfall++;
    let nurEskalation = false;
    if (code === 'ENOENT') {
      // fehlt die Claude-CLI erst bei der Eskalation und liegt die Stufe bei Ollama, ist nur die Eskalation aus, nicht die ganze Komposition
      const grund = 'CLI fehlt (' + String((e && e.message) || '').slice(0, 80) + ')';
      const llm = this.lage.llm;
      if (job.eskaliert && llm && typeof llm.anbieterFuer === 'function' && llm.anbieterFuer('abenteuer', STUFE) === 'ollama') { this.eskalationAus = grund; nurEskalation = true; } else this.aus = grund;
    }
    this.schreibe(Object.assign({ ausgang: 'ausfall', grund: code, fehler: [code + ': ' + String((e && e.message) || e).slice(0, 250)], begruendung: `Grenze ${job.art}: kein Abenteuer (Anbieter ausgefallen), das Spiel laeuft weiter`, plan: this.planInfo(job) }, this.absichtFelder(job), this.messung(job, r, e)));
    if (!nurEskalation) this.lage.notbetriebBeiFehler(e);   // FRE-01 C: Hinweis einmal je Sitzung (die Lage meldet; nur Modell-Ausfaelle, Daten notbetrieb_gruende)
  }
  abgelehnt(job, code, fehler, r) {
    if (this.job !== job) return;
    if (!NICHT_MODELL.includes(code) && this.eskalieren(job, code)) return;
    this.job = null; this.zustand = 'idle';
    this.zaehler.abgelehnt[code] = (this.zaehler.abgelehnt[code] || 0) + 1;
    this.schreibe(Object.assign({ ausgang: 'abgelehnt', grund: code, fehler: (fehler || [code]).slice(0, 6).map((f) => String(f).slice(0, 200)), begruendung: `Grenze ${job.art}: Bauplan abgelehnt (${code}), kein Abenteuer`, plan: this.planInfo(job, { antwort_zeichen: r && typeof r.text === 'string' ? r.text.length : null }) }, this.absichtFelder(job), this.messung(job, r)));
  }
  antwort(job, r) {
    if (r && r.cli) this.lage.cli = r.cli;
    const text = r && r.text;
    if (typeof text !== 'string' || !text.trim()) return this.abgelehnt(job, 'ANTWORT_LEER', ['leere Antwort'], r);
    if (text.length > this.W.antwort_max_zeichen) return this.abgelehnt(job, 'ANTWORT_ZU_GROSS', [`Antwort mit ${text.length} Zeichen (hoechstens ${this.W.antwort_max_zeichen})`], r);
    if (job.modus === 'absicht') return job.phase === 'verhandlung' ? this.verhandlungAntwort(job, r) : this.absichtAntwort(job, r);
    const gelesen = Prompt.bauplanAusText(text);
    if (gelesen.fehler) return this.abgelehnt(job, 'ANTWORT_UNLESBAR', [gelesen.fehler], r);
    const res = faden().abenteuerNeuAnbieten(this.game, gelesen.plan, { hex: job.hex });   // SUND-04b E3: mit den Wiederholungsregeln des Bretts
    if (!res.ok) return this.abgelehnt(job, codeVon(res.grund), res.fehler, r);
    this.angeboten(job, r, res.angebot);
  }
  angeboten(job, r, angebot) {
    this.job = null; this.zustand = 'idle';
    const typen = Prompt.typenVon(angebot.vorlage);
    this.zaehler.gueltig++;
    this.letzte.push(job.absichtName ? { nr: job.nr, typen, absicht: job.absichtName } : { nr: job.nr, typen });
    while (this.letzte.length > Math.max(1, this.W.letzte_abenteuer)) this.letzte.shift();
    this.schreibe(Object.assign({ ausgang: 'gueltig', begruendung: `Abenteuer ${angebot.ref} als Angebot ${angebot.nr} bei ${job.hex}`, plan: this.planInfo(job, { angebot: angebot.nr, vorlage: angebot.ref, typen, beats: angebot.vorlage.beats.length }) }, this.absichtFelder(job), this.messung(job, r)));
  }

  // ---------- SPL-02 E1: Betriebsmodus Absichten
  // Antwort auf den Prompt der Absichten: lesen > Kette (Kennungen des Prompts, Pruefer, Inszenierer, Brett). Unlesbar oder leer: wie im Beat-Plan (kein Angebot, ggf. Eskalation, kein zweiter Aufruf).
  absichtAntwort(job, r) {
    const gelesen = Absicht.lesen(r.text);
    if (gelesen.fehler) return this.abgelehnt(job, 'ANTWORT_UNLESBAR', [gelesen.fehler], r);
    job.absicht = gelesen.absicht;
    const f = Absicht.logFelder(gelesen.absicht);
    job.absichtName = f.absicht; job.bezugArt = f.bezug_art;
    const st = Absicht.ersterVersuch(this.game, gelesen.absicht, job.kennungen);
    if (st.stand === 'angenommen') return this.angeboten(job, r, st.angebot);
    if (st.stand === 'offen' && Absicht.verhandelbar(st.v, NICHT_MODELL) && !this.budgetGesperrt()) return this.verhandeln(job, r, st.v);
    return this.absichtAbgelehnt(job, r, st.v);
  }
  // ein Nein der Welt: der zweite, kleine Aufruf (Klartext des Neins + Absicht, kein Katalog). Zaehlt als Aufruf des Deckels und geht durch das Budget-Gate; die Kosten des ersten Aufrufs laufen im Eintrag mit.
  verhandeln(job, r, v) {
    job.vorkosten = this.messung(job, r);
    job.runde = 1; job.phase = 'verhandlung'; job.v = v;
    this.aufrufe++;
    job.input = Absicht.folgeInput(this.game, v, job.absicht, job.kennungen, job.nr);
    this.losschicken(job, false);
  }
  verhandlungAntwort(job, r) {
    const v = Absicht.folgeAntwort(this.game, job.v, r.text, job.kennungen);
    if (v.stand === 'angenommen') return this.angeboten(job, r, v.ergebnis.angebot);
    return this.absichtAbgelehnt(job, r, v);
  }
  // endgueltig kein Angebot: nie eine Eskalation (das Nein liegt an der Welt, nicht am Modell); grund = Code des Neins, die Grundtexte (koennen Namen tragen) stehen nicht im Logbuch
  absichtAbgelehnt(job, r, v) {
    if (this.job !== job) return;
    const code = Absicht.codeVon(v);
    this.job = null; this.zustand = 'idle';
    this.zaehler.abgelehnt[code] = (this.zaehler.abgelehnt[code] || 0) + 1;
    this.schreibe(Object.assign({ ausgang: 'abgelehnt', grund: code, fehler: Absicht.fehlerCodes(v), begruendung: `Grenze ${job.art}: Absicht abgelehnt (${code}), kein Abenteuer`, plan: this.planInfo(job, { antwort_zeichen: r && typeof r.text === 'string' ? r.text.length : null }) }, this.absichtFelder(job), this.messung(job, r)));
  }

  // ---------- Ende (Raumende, Neustart, Schalter aus): ein Aufruf in der Luft wird verworfen, spaete Antworten kommen nie an
  dispose() {
    if (this.disposed) return;
    this.abbrechen(this.job);
    this.disposed = true;
    this.job = null; this.zustand = 'idle'; this.inbox = [];
  }
  status() {
    const z = this.zaehler;
    return `Abenteuer-Komposition: Zustand ${this.zustand}, Aufrufe ${this.aufrufe}/${this.W.deckel_je_sitzung}, Grenzen seit Start ${this.grenzenSeit === Infinity ? '–' : this.grenzenSeit} (Cooldown ${this.W.cooldown_grenzen}), gueltig ${z.gueltig}, abgelehnt ${JSON.stringify(z.abgelehnt)}, Ausfall ${z.ausfall}, eskaliert ${z.eskaliert}, verspaetet ${z.verspaetet}, uebersprungen ${JSON.stringify(z.uebersprungen)}${this.aus ? ', Transport aus: ' + this.aus : ''}${this.eskalationAus ? ', Eskalation aus: ' + this.eskalationAus : ''}`;
  }
}
const angeboteMax = () => require('./faden-daten.js').WERTE.abenteuer.angebote_max;

function create(lage, opts) { return new AbenteuerSpielleiter(lage, opts); }
module.exports = { create, AbenteuerSpielleiter, STUFE };
