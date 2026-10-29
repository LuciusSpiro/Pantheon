'use strict';
// SUND-04b A2: Mutationsprobe zu tools/test-abenteuer.js (Muster tools/mutation-lage.js). Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel der
// Komposition von Abenteuern und der Stufen und verlangt, dass der Test rot wird (Exit != 0). Ueberlebt eine Mutation, deckt kein Test die Regel ab. Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau
// einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab; --trocken prueft nur die Anker.
//   node tools/mutation-abenteuer.js [begriff ...] [--trocken]      (npm run test:abenteuer-mutation)
// Bewusst nicht in der Liste (aequivalente Mutanten): „der Ring der letzten Abenteuer wird nicht gekuerzt“ (der Kontext schneidet ohnehin auf letzte_abenteuer), „Cooldown ohne aufrufe > 0“ (vor dem ersten Aufruf ist grenzenSeit
// unendlich), „inbox nach dispose leeren“ (update tut nach dispose nichts), „zuruecksetzen leert die Besitzer nicht“ (ein Besitzer ohne Eintrag wird nie gelesen), „tote Besitzer (WeakRef) zaehlen mit“ (braucht die Muellabfuhr:
// nicht deterministisch pruefbar; die Regel steht im Kommentar), „Router: Eskalation nur fuer Ollama (&& anbieter === 'ollama') in norm“ (eskalationFuer prueft den Anbieter ein zweites Mal).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abenteuer-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-abenteuer.js'], ['tools/test-transport-router.js'], ['tools/test-texte-pool.js'], ['tools/test-faden-bauplan.js']];
for (const f of ['test-abenteuer.js', 'messe-abenteuer.js', 'regie-fixture.js', 'faden-fixture.js', 'transport-testhilfe.js', 'regie-bericht.js', 'test-transport-router.js', 'test-texte-pool.js', 'test-faden-bauplan.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const AS = 'server/sim/abenteuer-spielleiter.js', AP = 'server/sim/abenteuer-prompt.js', AM = 'server/sim/abenteuer-mock.js', ST = 'server/mission/stufen.js', RT = 'server/mission/transport-router.js',
  LL = 'server/mission/llm.js', TP = 'server/sim/texte-pool.js', DD = 'server/sim/faden-daten.js', FA = 'server/sim/faden.js', LS = 'server/sim/lage-spielleiter.js', BR = 'tools/regie-bericht.js',
  RL = 'server/mission/regielog.js', ME = 'tools/messe-abenteuer.js', SJ = 'content/spielleiter/stufen.json', AW = 'content/welt/abenteuer-werte.json', SY = 'content/spielleiter/prompts/abenteuer.system.md', LP = 'server/sim/lage-prompt.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Schalter und Grenzen
  [AS, "return !this.disposed && !!this.game.weltsim && faden().aktiv(this.game); }", "return !this.disposed && !!this.game.weltsim; }", 'Schalter: die Komposition laeuft auch ohne FAEDEN=1'],
  [AS, "return !this.disposed && !!this.game.weltsim && faden().aktiv(this.game); }", "return !!this.game.weltsim && faden().aktiv(this.game); }", 'dispose: die Komposition laeuft nach dispose weiter'],
  [AS, "    if (!this.W.grenzen.includes(art)) return null;\n", "", 'Grenzen: jede Art loest aus (Daten ignoriert)'],
  [AS, "    if (this.modusAus()) return null;                                      // Modus off", "    if (false) return null;                                      // Modus off", 'Modus off: der Spielleiter fragt trotzdem an'],
  [LS, "    try { this.abenteuer.beiGrenze(art); } catch (e) { this.fehlerZaehlen('abenteuer-grenze', e); }", "", 'Lage: die Grenze erreicht die Komposition nie'],
  [LS, "    try { this.abenteuer.beiGrenze(art); } catch (e) { this.fehlerZaehlen('abenteuer-grenze', e); }", "    this.abenteuer.beiGrenze(art);", 'Lage: eine Ausnahme der Komposition erreicht den Hook'],
  [LS, "    try { this.abenteuer.update(dt); } catch (e) { this.fehlerZaehlen('abenteuer-update', e); }", "", 'Lage: update erreicht die Komposition nie'],
  [LS, "    try { this.abenteuer.update(dt); } catch (e) { this.fehlerZaehlen('abenteuer-update', e); }", "    this.abenteuer.update(dt);", 'Lage: eine Ausnahme der Komposition erreicht update'],
  [LS, "    try { this.abenteuer.dispose(); } catch (e) { this.fehlerZaehlen('abenteuer-dispose', e); }\n", "", 'Lage: dispose beendet die Komposition nicht'],
  [LS, "    const r = this.planGrenze(art);\n", "    const r = null;\n", 'Lage: der Plan der Lage wird bei einer Grenze nicht mehr geplant'],
  [LS, "    if (sub === 'abenteuer') {", "    if (sub === 'abenteuer_x') {", 'Debug: lage abenteuer fehlt'],
  [LS, "        this.stufenMelden();\n", "", 'Stufen: eine kaputte Datei wird nicht ins Logbuch gemeldet'],
  [LS, "      if (fehler.length) Regie.schreibe(", "      if (true) Regie.schreibe(", 'Stufen: auch eine fehlerfreie Konfiguration wird gemeldet'],
  // ---- Takt
  [AS, "    this.grenzenSeit++;\n", "", 'Cooldown: Grenzen werden nicht gezaehlt'],
  [AS, "    if (this.aufrufe > 0 && this.grenzenSeit < this.W.cooldown_grenzen) return this.ueberspringen('cooldown', art);\n", "", 'Cooldown fehlt'],
  [AS, "this.grenzenSeit < this.W.cooldown_grenzen)", "this.grenzenSeit <= this.W.cooldown_grenzen)", 'Cooldown: eine Grenze zu lang'],
  [AS, "    this.grenzenSeit = 0;\n    this.zustand = 'angefragt';", "    this.zustand = 'angefragt';", 'Cooldown: der Start wird nicht gemerkt'],
  [AS, "    if (this.aufrufe >= this.W.deckel_je_sitzung) return this.ueberspringen('deckel', art);\n", "", 'Deckel je Sitzung fehlt'],
  [AS, "    this.aufrufe++;\n    this.grenzenSeit = 0;", "    this.grenzenSeit = 0;", 'Deckel: Aufrufe werden nicht gezaehlt'],
  [AS, "    if (this.offeneAngebote() >= angeboteMax()) return this.ueberspringen('angebote_voll', art);\n", "", 'Obergrenze der Angebote fehlt im Takt'],
  [AS, "    if (this.offeneAngebote() >= angeboteMax()) return this.ueberspringen('angebote_voll', 'debug');\n", "", 'Obergrenze der Angebote fehlt im Debug-Aufruf'],
  [AS, "    if (this.zustand !== 'idle') return this.ueberspringen('beschaeftigt', art);\n", "", 'ein Job zugleich: zweiter Aufruf waehrend des ersten'],
  [AS, "    if (this.zustand !== 'idle') return this.ueberspringen('beschaeftigt', 'debug');\n", "", 'ein Job zugleich: Debug-Aufruf waehrend des ersten'],
  [AS, "    if (this.aus) return this.ueberspringen('transport_aus', art);\n", "", 'CLI fehlt: der Transport bleibt an, jede Grenze versucht es neu'],
  [AS, "    if (code === 'ENOENT') this.aus =", "    if (false) this.aus =", 'CLI fehlt: der Transport wird nicht abgeschaltet'],
  [AS, "    if (!ort) return this.ueberspringen('kein_ort', art);\n", "", 'ohne spielbaren Ort wird trotzdem angefragt'],
  [AS, "    if (llm.mode === 'live' && llm.anbieterFuer('abenteuer', STUFE) !== 'ollama' && LLM.budget().remaining < this.W.min_budget)", "    if (false)", 'Budget: wird nicht geprueft'],
  [AS, "llm.anbieterFuer('abenteuer', STUFE) !== 'ollama' && LLM.budget()", "true && LLM.budget()", 'Budget: gilt auch fuer eine Stufe bei Ollama'],
  [AS, "    this.letzterSprung = null;\n    this.aufrufe++;", "    this.aufrufe++;", 'Logbuch: ein zweiter Cooldown nach einem Start wird nicht mehr gemeldet'],
  [AS, "    if (this.letzterSprung !== grund) {", "    if (true) {", 'Logbuch: uebersprungene Grenzen fluten'],
  // ---- Tick-Pfad, Frist, Abbruch
  [AS, "    this.abholen();\n    this.fristPruefen();\n    if (this.zustand === 'angefragt') this.starten();", "    this.abholen();\n    if (this.zustand === 'angefragt') this.starten();", 'Frist: ein haengender Aufruf wird nie zum Ausfall'],
  [AS, "this.game.time - job.start > this.W.timeout_s + 1", "this.game.time - job.start > this.W.timeout_s", 'Frist: eine Sekunde zu kurz'],
  [AS, "    if (this.game.time - job.start > this.W.timeout_s + 1) {\n      this.abbrechen(job);\n", "    if (this.game.time - job.start > this.W.timeout_s + 1) {\n", 'Abbruch: die Frist beendet den Transport nicht'],
  [AS, "    this.abbrechen(this.job);\n    this.disposed = true;", "    this.disposed = true;", 'Abbruch: dispose beendet den Transport nicht'],
  [AS, "const ao = { timeoutMs: 1000 * this.W.timeout_s, signal: job.abbruch.signal, stufe: STUFE };", "const ao = { timeoutMs: this.W.timeout_s, signal: job.abbruch.signal, stufe: STUFE };", 'Frist: Sekunden statt Millisekunden an den Transport'],
  [AS, "const ao = { timeoutMs: 1000 * this.W.timeout_s, signal: job.abbruch.signal, stufe: STUFE };", "const ao = { timeoutMs: 1000 * this.W.timeout_s, stufe: STUFE };", 'Abbruch: kein AbortSignal an den Transport'],
  [AS, "const ao = { timeoutMs: 1000 * this.W.timeout_s, signal: job.abbruch.signal, stufe: STUFE };", "const ao = { timeoutMs: 1000 * this.W.timeout_s, signal: job.abbruch.signal };", 'Stufe: der Aufruf nennt seine Stufe nicht'],
  [AS, "        if (it.e && it.e.code === 'ABORTED') continue;\n", "", 'Abbruch: eine abgebrochene Antwort zaehlt als spaete Antwort'],
  [AS, "      if (!job || job.token !== it.token) {", "      if (!job) {", 'spaete Antwort: ein veralteter Token wird angenommen'],
  [AS, "        this.zaehler.verspaetet++;\n", "", 'spaete Antwort: wird nicht gezaehlt'],
  [AS, "    if (code !== 'ABORTED' && this.eskalieren(job, code)) return;", "    if (this.eskalieren(job, code)) return;", 'Eskalation: ein Abbruch des Transports wird eskaliert'],
  [AS, "    if (bau.fehler) return this.ausfall(job, LLM.llmError('EXIT', bau.fehler), null);\n", "", 'Prompt zu gross: wird trotzdem angefragt'],
  [AS, "    job.token = ++this.seq; job.start = this.game.time;", "    job.token = this.seq; job.start = this.game.time;", 'Token: jede Antwort traegt denselben Token'],
  // ---- Ergebnis, Logbuch
  [AS, "    if (typeof text !== 'string' || !text.trim()) return this.abgelehnt(job, 'ANTWORT_LEER', ['leere Antwort'], r);\n", "", 'Antwort: leer wird nicht abgelehnt'],
  [AS, "    if (text.length > this.W.antwort_max_zeichen) return", "    if (text.length >= this.W.antwort_max_zeichen) return", 'Antwort: genau die Grenze gilt schon als zu gross'],
  [AS, "    if (text.length > this.W.antwort_max_zeichen) return this.abgelehnt(job, 'ANTWORT_ZU_GROSS'", "    if (false) return this.abgelehnt(job, 'ANTWORT_ZU_GROSS'", 'Antwort: zu grosse Antwort wird gelesen'],
  [AS, "    if (gelesen.fehler) return this.abgelehnt(job, 'ANTWORT_UNLESBAR', [gelesen.fehler], r);\n", "", 'Antwort: Muell wird nicht abgelehnt'],
  [AS, "faden().abenteuerAnbieten(this.game, gelesen.plan, { hex: job.hex });", "faden().abenteuerAnbieten(this.game, gelesen.plan, { hex: '0202' });", 'Angebot: nicht am Ort der Crew'],
  [AS, "    if (!res.ok) return this.abgelehnt(job, codeVon(res.grund), res.fehler, r);\n", "", 'Antwort: Ablehnung des Pruefers wird uebergangen'],
  [AS, "const codeVon = (t) => String(t).split(':')[0];", "const codeVon = (t) => String(t);", 'Ablehnung: der Code ist der ganze Text'],
  [AS, "    this.letzte.push({ nr: job.nr, typen });\n", "", 'Kontext: das angebotene Abenteuer wird nicht gemerkt'],
  [AS, "    this.zaehler.gueltig++;\n", "", 'Zaehler: gueltige Angebote werden nicht gezaehlt'],
  [AS, "    this.zaehler.abgelehnt[code] = (this.zaehler.abgelehnt[code] || 0) + 1;\n", "", 'Zaehler: Ablehnungen werden nicht gezaehlt'],
  [AS, "    this.zaehler.ausfall++;\n", "", 'Zaehler: Ausfaelle werden nicht gezaehlt'],
  [AS, "    const m = { dauer_s: r && r.sec != null ? r.sec :", "    const m = { dauer_s: r && r.sec != null ? 0 :", 'Messung: Dauer fehlt'],
  [AS, "tokens: r && r.tokens ? r.tokens : 0 };", "tokens: 0 };", 'Messung: Tokens fehlen'],
  [AS, "    m.modell = (r && (r.modell || r.modelId)) || (e && e.modell) || (live ? null : 'mock');", "    m.modell = (live ? null : 'mock');", 'Messung: Modell fehlt'],
  [AS, "    m.geld = r && Number.isFinite(Number(r.cost)) ? Number(r.cost) :", "    m.geld = r && Number.isFinite(Number(r.cost)) ? 0 :", 'Messung: Geld fehlt'],
  [AS, "    m.anbieter = (r && r.anbieter) || (e && e.anbieter) ||", "    m.anbieter = (r && r.source === 'live' ? 'claude' : null) ||", 'Messung: der Anbieter eines Ausfalls oder einer Antwort fehlt'],
  [AS, "    if (r && r.eskaliert) m.eskaliert = true; else if (job && job.eskaliert) m.eskaliert = true;", "", 'Messung: eskaliert fehlt'],
  [AS, "this.schreibe(Object.assign({ ausgang: 'ausfall', grund: code,", "this.schreibe(Object.assign({ ausgang: 'ausfall', grund: 'EXIT',", 'Logbuch: der Fehlercode eines Ausfalls fehlt'],
  [AS, "ausgang: 'gueltig', begruendung:", "ausgang: 'angewandt', begruendung:", 'Logbuch: gueltig heisst anders'],
  [AS, "plan: this.planInfo(job, { angebot: res.angebot.nr, vorlage: res.angebot.ref, typen,", "plan: this.planInfo(job, { angebot: res.angebot.nr, vorlage: res.angebot.ref, typen: [],", 'Logbuch: die Typenfolge fehlt'],
  [AS, "{ art: 'abenteuer_bauplan', quelle:", "{ art: 'abenteuer', quelle:", 'Logbuch: die Art heisst anders'],
  [AS, "    this.schreibe(Object.assign({ ausgang: 'eskaliert', grund,", "    this.schreibe(Object.assign({ ausgang: 'x', grund,", 'Logbuch: die Eskalation wird nicht vermerkt'],
  // ---- Eskalation
  [AS, "    if (job.eskaliert || !job.input || !llm || typeof llm.eskalationMoeglich !== 'function' || !llm.eskalationMoeglich('abenteuer', STUFE)) return false;", "    if (!job.input || !llm || typeof llm.eskalationMoeglich !== 'function' || !llm.eskalationMoeglich('abenteuer', STUFE)) return false;", 'Eskalation: mehr als einmal je Aufruf'],
  [AS, "|| !llm.eskalationMoeglich('abenteuer', STUFE)) return false;", ") return false;", 'Eskalation: auch wenn die Stufe sie nicht erlaubt'],
  [AS, "    job.token = ++this.seq; job.start = this.game.time; job.wall = Date.now(); job.eskaliert = eskalation;", "    job.token = ++this.seq; job.start = this.game.time; job.wall = Date.now();", 'Eskalation: der Aufruf merkt sich nicht, dass er eskaliert ist'],
  [AS, "p = eskalation ? llm.eskaliere('abenteuer', job.input, ao) : llm.ask('abenteuer', job.input, ao);", "p = llm.ask('abenteuer', job.input, ao);", 'Eskalation: geht nicht an den Eskalations-Anbieter'],
  [AS, "    if (code !== 'ABORTED' && this.eskalieren(job, code)) return;   // ein Abbruch eskaliert nie\n", "", 'Eskalation: ein Ausfall wird nie eskaliert'],
  [AS, "    if (this.eskalieren(job, code)) return;\n    this.job = null; this.zustand = 'idle';\n    this.zaehler.abgelehnt", "    this.job = null; this.zustand = 'idle';\n    this.zaehler.abgelehnt", 'Eskalation: eine abgelehnte Antwort wird nie eskaliert'],
  // ---- Prompt
  [AP, "  const a = JSON.parse(Ausschnitt.ausschnitt(game, { stufe }).text);", "  const a = JSON.parse(Ausschnitt.ausschnitt(game, { stufe }).text); a.crew = Object.assign({}, a.crew, { anzahl: 1 });", 'Prompt: die Crew-Anzahl steht im Kontext'],
  [AP, "    chronik: (a.chronik || []).slice(-werte.chronik_zeilen),", "    chronik: (a.chronik || []),", 'Prompt: die Chronik wird nicht auf die Zeilen der Daten gekuerzt'],
  [AP, "slice(-werte.wendepunkte_max);", "slice(-6);", 'Prompt: wendepunkte_max der Daten wird ignoriert'],
  [AP, "    letzte_abenteuer: (letzte || []).slice(-werte.letzte_abenteuer).map((x) => x.typen),", "    letzte_abenteuer: (letzte || []).map((x) => x.typen),", 'Prompt: letzte_abenteuer der Daten wird ignoriert'],
  [AP, "    letzte_abenteuer: (letzte || []).slice(-werte.letzte_abenteuer).map((x) => x.typen),", "    letzte_abenteuer: (letzte || []).slice(-werte.letzte_abenteuer).map((x) => x.titel || x.typen),", 'Prompt: Titel fruehere Abenteuer im Kontext'],
  [AP, "    if (prompt.length <= w.prompt_max_zeichen) return", "    if (true) return", 'Prompt: die Obergrenze wird nicht eingehalten'],
  [AP, "  return { fehler: `Prompt zu gross", "  return { prompt: '', zeichen: 0, fehler: null, x: `Prompt zu gross", 'Prompt: zu grosser Prompt gibt keinen Fehler'],
  [AP, "    if (f.phase === 'abgeschlossen') continue;\n    const v = D.vorlage(f.vorlage);", "    const v = D.vorlage(f.vorlage);", 'Kontext: abgeschlossene Faeden stehen als aktiv'],
  [AP, "    if (f.plan) { e.typen = typenVon(f.plan); abenteuer++; }", "    if (f.plan) { e.typen = typenVon(f.plan); e.nsc = f.nsc.name; abenteuer++; }", 'Kontext: der Name des NSC steht im Prompt'],
  [AP, "{ aktiv, laufende_abenteuer: abenteuer, abenteuer_angebote: F.abenteuerAngebote.map((a) => typenVon(a.vorlage)),", "{ aktiv, laufende_abenteuer: abenteuer, abenteuer_angebote: F.abenteuerAngebote.map((a) => a.vorlage.titel),", 'Kontext: der Titel der offenen Angebote steht im Prompt'],
  [AP, "const r = LagePrompt.objektAusText(text, ['beats', 'titel', 'format']);", "const r = LagePrompt.objektAusText(text, ['xyz']);", 'Antwort lesen: erkennt das Bauplan-Objekt nicht an seinen Schluesseln'],
  [AP, "    const bp = c.bauplan;\n    if (!bp || typeof bp !== 'object') continue;", "    const bp = c.bauplan || {};", 'Katalog: auch Typen ohne Standards stehen im Katalog'],
  [AP, "    return `${k} (Standard ${s.standard === '$ort' ? 'der Ort des Abenteuers' : s.standard}; erlaubt ${erlaubt})`;", "    return `${k}`;", 'Katalog: Standard und erlaubte Werte der Parameter fehlen'],
  [AP, "${nach}.`);\n  }", "${c.abschluss ? '' : ''}.`);\n  }", 'Katalog: die Zustaende nach dem Ausgang fehlen'],
  // ---- Stufen
  [ST, "const STANDARD_SLOTS = { ankuendigung: 'geruechte_funk',", "const STANDARD_SLOTS = { ankuendigung: 'figuren_neben',", 'Stufen: ein Slot gehoert der falschen Stufe (Standard)'],
  [ST, "  bauplan: { anbieter: 'claude', modell: 'sonnet', eskalation: false },", "  bauplan: { anbieter: 'ollama', modell: null, eskalation: false },", 'Stufen: der sichere Standard von bauplan ist Ollama'],
  [ST, "  figuren_neben: { anbieter: 'ollama', modell: null, eskalation: false },", "  figuren_neben: { anbieter: 'claude', modell: 'sonnet', eskalation: false },", 'Stufen: der sichere Standard von figuren_neben ist Claude'],
  [ST, "const KIND_STUFE = { abenteuer: 'bauplan' };", "const KIND_STUFE = {};", 'Stufen: die Art abenteuer gehoert keiner Stufe'],
  [ST, "      if (!ANBIETER.includes(a)) fehler.push(", "      if (false) fehler.push(", 'Umgebung: ein unbekannter Anbieter wird uebernommen'],
  [ST, "      else { if (a !== anbieter) modell = standardModell(a); anbieter = a; cur.quelle = 'env'; }", "      else { anbieter = a; cur.quelle = 'env'; }", 'Umgebung: beim Anbieterwechsel bleibt das Modell des alten Anbieters'],
  [ST, "      if (!MODELL_FORM.test(String(vM))) fehler.push(", "      if (false) fehler.push(", 'Umgebung: ein unbrauchbarer Modellname wird uebernommen'],
  [ST, "    if (vE !== undefined && vE !== '') {", "    if (false) {", 'Umgebung: LLM_ESKALATION_<STUFE> wird ignoriert'],
  [ST, "      if (w === null) fehler.push(", "      if (false) fehler.push(", 'Umgebung: ein unklarer Eskalations-Schalter wird nicht gemeldet'],
  [ST, "const s = String(v).toLowerCase(); return s === '1' || s === 'an' ||", "const s = String(v).toLowerCase(); return s === 'an' ||", 'Umgebung: 1 gilt nicht als an'],
  [ST, "if (stufen[name].anbieter === 'claude' && stufen[name].eskalation) stufen[name].eskalation = false;", "if (false) stufen[name].eskalation = false;", 'Stufen: Eskalation fuer eine Stufe bei Claude'],
  [ST, "      formFehler = require('../weltstand.js').fallbackValidate(doc, schema);", "      formFehler = [];", 'Datei: die Form wird nicht geprueft'],
  [ST, "        if (!STUFEN.includes(name)) { fehler.push(", "        if (false) { fehler.push(", 'Datei: eine unbekannte Stufe wird uebernommen'],
  [ST, "        if (mod !== null && !MODELL_FORM.test(String(mod))) { fehler.push(", "        if (false) { fehler.push(", 'Datei: ein unbrauchbarer Modellname wird uebernommen'],
  [ST, "        stufen[name] = { anbieter: x.anbieter, modell: mod, eskalation: x.eskalation === true, quelle: 'datei' };", "        stufen[name] = { anbieter: x.anbieter, modell: mod, eskalation: false, quelle: 'datei' };", 'Datei: eskalation wird ignoriert'],
  [ST, "  } catch (err) { fehler.push(`stufen.json: nicht lesbar", "  } catch (err) { if (false) fehler.push(`stufen.json: nicht lesbar", 'Datei: ein Lesefehler wird nicht gemeldet'],
  [ST, "        if (STUFEN.includes(st)) slots[slot] = st; else fehler.push(", "        slots[slot] = st; if (false) fehler.push(", 'Datei: eine unbekannte Stufe eines Slots wird uebernommen'],
  [ST, "return STUFEN.filter((n) => { const s = geladen.stufen[n], d = STANDARD[n]; return s.anbieter !== d.anbieter || (s.modell || null) !== (d.modell || null) || s.eskalation !== d.eskalation; });", "return STUFEN.filter((n) => { const s = geladen.stufen[n], d = STANDARD[n]; return s.anbieter !== d.anbieter || s.eskalation !== d.eskalation; });", 'Stufen: ein anderes Modell zaehlt nicht als Abweichung'],
  [ST, "const mod = x.modell === undefined || x.modell === null ? standardModell(x.anbieter) : x.modell;", "const mod = x.modell === undefined || x.modell === null ? null : x.modell;", 'Datei: ohne Modell kein Standard-Modell des Anbieters'],
  // ---- Router
  [RT, "    if (stufe && cfg[stufe] && STUFEN.includes(stufe)) return stufe;\n", "", 'Router: die Stufe einer Anfrage geht nicht vor der Art'],
  [RT, "    return s && cfg[s] ? s : kind;", "    return kind;", 'Router: kind abenteuer findet seine Stufe nicht'],
  [RT, "    if (STUFEN.includes(k) && c.eskalation !== true) return null;\n", "", 'Router: eine Stufe eskaliert ohne ihren Schalter'],
  [RT, "return { anbieter, modell, eskalation: e.eskalation === true && anbieter === 'ollama' };", "return { anbieter, modell, eskalation: true };", 'Router: jede Stufe darf eskalieren'],
  [RT, "|| Stufen.abweichend(geladen).length > 0;", ";", 'Router: eine abweichende Stufe (Datei) erzeugt keinen Router'],
  [RT, "  const arten = {}; const warnungen = geladen.fehler.slice();", "  const arten = {}; const warnungen = [];", 'Router: die Fehler der Stufen-Konfiguration fehlen in den Warnungen'],
  [RT, "eskalation: geladen.stufen[s].eskalation };", "eskalation: false };", 'Router: die Eskalation der Stufe aus der Umgebung wird nicht uebernommen'],
  [RT, "  for (const s of STUFEN) arten[s] = { anbieter: geladen.stufen[s].anbieter, modell: geladen.stufen[s].modell || undefined,", "  for (const s of STUFEN) arten[s] = { anbieter: 'claude', modell: geladen.stufen[s].modell || undefined,", 'Router: der Anbieter der Stufe wird nicht uebernommen'],
  [RT, "      const eintrag = cfg[schluessel(co.kind, co.stufe)];", "      const eintrag = cfg[co.kind];", 'Router: der Aufruf waehlt den Anbieter nach der Art statt nach der Stufe'],
  [RT, "  const anbieterFuer = (kind, stufe) => (cfg[schluessel(kind, stufe)] || { anbieter: 'claude' }).anbieter;", "  const anbieterFuer = (kind, stufe) => (cfg[kind] || { anbieter: 'claude' }).anbieter;", 'Router: anbieterFuer kennt keine Stufe'],
  // ---- llm.js
  [LL, "    if (ao.stufe) co.stufe = ao.stufe;", "", 'llm: die Stufe erreicht den Router nicht'],
  [LL, "transport.eskalationFuer(kind, ao.stufe) : null;", "transport.eskalationFuer(kind) : null;", 'llm: eskaliere kennt die Stufe nicht'],
  [LL, "      if (kind === 'abenteuer') return { text: mockAbenteuer(input),", "      if (false) return { text: mockAbenteuer(input),", 'llm: der Mock kennt kind abenteuer nicht'],
  [LL, "kind === 'lage' ? mockLage(input) : kind === 'abenteuer' ? mockAbenteuer(input) :", "kind === 'lage' ? mockLage(input) :", 'llm: script (leere Liste) kennt kind abenteuer nicht'],
  [LL, "const KINDS = ['grobplan', 'szene', 'text', 'lage', 'abenteuer'];", "const KINDS = ['grobplan', 'szene', 'text', 'lage'];", 'llm: kind abenteuer ist unbekannt'],
  [LL, "anbieterFuer: (kind, stufe) => (mode === 'live' && typeof transport.anbieterFuer === 'function' ? transport.anbieterFuer(kind, stufe) : 'claude'),", "anbieterFuer: (kind, stufe) => (mode === 'live' && typeof transport.anbieterFuer === 'function' ? transport.anbieterFuer(kind) : 'claude'),", 'llm: anbieterFuer kennt die Stufe nicht'],
  [LL, "!!transport.eskalationFuer(kind, stufe),", "!!transport.eskalationFuer(kind),", 'llm: eskalationMoeglich kennt die Stufe nicht'],
  // ---- Text-Pool
  [TP, "  const ao = Object.assign({ timeoutMs: W.job_timeout_s * 1000, schema: Pruefer.schemaFuer(spec.slot) }, stufe ? { stufe } : {});", "  const ao = Object.assign({ timeoutMs: W.job_timeout_s * 1000, schema: Pruefer.schemaFuer(spec.slot) }, {});", 'Pool: der Slot nennt seine Stufe nicht'],
  [TP, "catch (e) { if (e && e.code !== 'ABORTED' && esk()) r = await", "catch (e) { if (esk()) r = await", 'Pool: ein Abbruch wird eskaliert'],
  [TP, "catch (e) { if (e && e.code !== 'ABORTED' && esk()) r = await llm.eskaliere('text', input, ao); else throw e; }", "catch (e) { throw e; }", 'Pool: ein Ausfall der Stufe wird nie eskaliert'],
  [TP, "      if (stufe && !r.eskaliert && typeof llm.eskalationMoeglich === 'function' && llm.eskalationMoeglich('text', stufe)) {", "      if (false) {", 'Pool: eine ungueltige Antwort wird nie eskaliert'],
  [TP, "      if (stufe && !r.eskaliert && typeof llm.eskalationMoeglich === 'function' && llm.eskalationMoeglich('text', stufe)) {", "      if (stufe && !r.eskaliert && typeof llm.eskalationMoeglich === 'function') {", 'Pool: eine ungueltige Antwort wird auch ohne erlaubte Eskalation eskaliert'],
  [TP, "    const eskAn = Stufen.STUFEN.some((s) => St.stufen[s].eskalation);", "    const eskAn = true;", 'Pool: der Router erlaubt immer eine Eskalation'],
  [TP, "    const eskAn = Stufen.STUFEN.some((s) => St.stufen[s].eskalation);", "    const eskAn = false;", 'Pool: die Eskalation einer Stufe erreicht den Router nie'],
  [TP, "modell: St.stufen[s].modell || (St.stufen[s].anbieter === 'ollama' ? modell : undefined),", "modell: St.stufen[s].modell,", 'Pool: ohne Modell der Stufe gilt LLM_MODELL_TEXT nicht mehr'],
  [TP, "    if (St.fehler.length) logge(game,", "    if (false) logge(game,", 'Pool: eine kaputte Stufendatei wird nicht gemeldet'],
  [TP, "{ eskaliert: true } : {}));\n}", "{} : {}));\n}", 'Pool: die Eskalation steht nicht im Logbuch'],
  // ---- Register
  [DD, "  if (!besitzer || typeof besitzer !== 'object') { b.dauer = true; return; }", "  b.dauer = true; if (!besitzer || typeof besitzer !== 'object') return;", 'Register: jeder Eintrag bleibt fuer immer'],
  [DD, "  if (!besitzer || typeof besitzer !== 'object') { b.dauer = true; return; }", "  if (!besitzer || typeof besitzer !== 'object') { return; }", 'Register: ein Eintrag ohne Besitzer faellt beim Aufraeumen weg'],
  [DD, "    b.refs = b.refs.filter((r) => { const o = r.deref(); return o !== undefined && !(o === besitzer && !noetig.has(id)); });", "    b.refs = b.refs.filter((r) => { const o = r.deref(); return o !== undefined; });", 'Register: ein Besitzer gibt nichts frei'],
  [DD, "    b.refs = b.refs.filter((r) => { const o = r.deref(); return o !== undefined && !(o === besitzer && !noetig.has(id)); });", "    b.refs = b.refs.filter((r) => { const o = r.deref(); return o !== undefined && o !== besitzer; });", 'Register: ein Besitzer gibt auch die frei, die er noch braucht'],
  [DD, "    if (!b.dauer && b.refs.length === 0) { abenteuer.delete(id); abenteuerBesitzer.delete(id); entfernt++; }", "    if (!b.dauer) { abenteuer.delete(id); abenteuerBesitzer.delete(id); entfernt++; }", 'Register: ein Eintrag faellt weg, obwohl ein anderes Spiel ihn braucht'],
  [DD, "    if (!b.dauer && b.refs.length === 0) { abenteuer.delete(id); abenteuerBesitzer.delete(id); entfernt++; }", "    if (!b.dauer && b.refs.length === 0) { abenteuerBesitzer.delete(id); entfernt++; }", 'Register: ein freier Eintrag wird nicht entfernt'],
  [DD, "    if (!b.dauer && b.refs.length === 0) { abenteuer.delete(id); abenteuerBesitzer.delete(id); entfernt++; }", "    if (!b.dauer && b.refs.length === 0) { abenteuer.delete(id); abenteuerBesitzer.delete(id); }", 'Register: entfernt wird nicht gezaehlt'],
  [DD, "    const r = registriereAbenteuer(p, besitzer);\n    if (!r.ok) fehler.push(", "    const r = { ok: true, id: p.id };\n    if (!r.ok) fehler.push(", 'Register: ein fehlender Plan eines laufenden Fadens wird nicht wieder eingetragen'],
  [DD, "    if (!istObjekt(p) || typeof p.id !== 'string') continue;\n    const r = registriereAbenteuer(p, besitzer);\n    if (!r.ok) fehler.push(String(p.id).slice(0, 32) + ': ' + String(r.fehler[0]).slice(0, 80));\n    else noetig.add(p.id);", "    if (!istObjekt(p) || typeof p.id !== 'string') continue;\n    const r = registriereAbenteuer(p, besitzer);\n    if (!r.ok) fehler.push(String(p.id).slice(0, 32) + ': ' + String(r.fehler[0]).slice(0, 80));", 'Register: die genannten Plaene gelten nicht als noetig'],
  [DD, "    if (!r.ok) fehler.push(String(p.id).slice(0, 32) + ': ' + String(r.fehler[0]).slice(0, 80));\n", "", 'Register: ein unbrauchbarer Plan wird nicht gemeldet'],
  [DD, "  return { entfernt, behalten: abenteuer.size, fehler };", "  return { entfernt, behalten: 0, fehler };", 'Register: behalten wird nicht gemeldet'],
  [DD, "  if (r.ok) besitzerMerken(r.id, besitzer);\n", "", 'Register: der Besitzer wird nicht gemerkt'],
  [FA, "  const reg = D.registriereAbenteuer(a.vorlage, F);", "  const reg = D.registriereAbenteuer(a.vorlage);", 'Faden: ein geoeffnetes Abenteuer hat keinen Besitzer'],
  [FA, "x.plan.id === x.vorlage ? D.registriereAbenteuer(x.plan, F) :", "x.plan.id === x.vorlage ? D.registriereAbenteuer(x.plan) :", 'Faden: ein geladener Plan hat keinen Besitzer'],
  [FA, "    const r = leseFaden(x, F);\n", "    const r = leseFaden(x);\n", 'Faden: lesen gibt den Besitzer nicht weiter'],
  [FA, "  abenteuerRegisterAufraeumen(game);   // SUND-04b A2\n", "", 'Faden: das Taetigkeitsende raeumt nicht auf'],
  [FA, "  melde(game, 'geoeffnet', f.id, `Abenteuer ${f.id} (${v.id}) geöffnet: NSC ${nsc.id}, Abstand ${f.abstand}`, { faden: f.id, vorlage: v.id, volk, angebot: a.nr });\n  abenteuerRegisterAufraeumen(game);\n", "  melde(game, 'geoeffnet', f.id, `Abenteuer ${f.id} (${v.id}) geöffnet: NSC ${nsc.id}, Abstand ${f.abstand}`, { faden: f.id, vorlage: v.id, volk, angebot: a.nr });\n", 'Faden: das Oeffnen raeumt nicht auf'],
  [FA, "    const plaene = F.liste.filter((f) => f.plan).map((f) => f.plan).concat(F.abenteuerAngebote.map((a) => a.vorlage));", "    const plaene = F.liste.filter((f) => f.plan && f.phase !== 'abgeschlossen').map((f) => f.plan).concat(F.abenteuerAngebote.map((a) => a.vorlage));", 'Faden: ein abgeschlossenes Abenteuer gilt nicht als gebraucht'],
  [FA, "    const plaene = F.liste.filter((f) => f.plan).map((f) => f.plan).concat(F.abenteuerAngebote.map((a) => a.vorlage));", "    const plaene = F.liste.filter((f) => f.plan).map((f) => f.plan);", 'Faden: ein offenes Angebot gilt nicht als gebraucht'],
  [FA, "    const plaene = F.liste.filter((f) => f.plan).map((f) => f.plan).concat(F.abenteuerAngebote.map((a) => a.vorlage));", "    const plaene = F.abenteuerAngebote.map((a) => a.vorlage);", 'Faden: ein laufender Faden gilt nicht als gebraucht'],
  // ---- Mock
  [AM, "  const kaputt = rng() < M.ungueltig_anteil;", "  const kaputt = rng() > M.ungueltig_anteil;", 'Mock: der Anteil ungueltiger Plaene ist umgekehrt'],
  [AM, "    if (Bauplan.expandiere(plan).ok) return plan;", "    return plan;", 'Mock: die gueltigen Plaene sind nicht geprueft'],
  [AM, "  const rng = rngVon(['abenteuer', a.nr, a.art, a.hex, k.tick, (k.ruf && JSON.stringify(k.ruf)) || '', (k.chronik || []).length].join('|'));", "  const rng = rngVon('abenteuer');", 'Mock: nicht vom Aufruf abhaengig'],
  [AM, "  proto_schluessel: (p) => JSON.stringify(p).replace('{', '{\"__proto__\":{\"x\":1},'),", "  proto_schluessel: (p) => JSON.stringify(p),", 'Mock: die Korruption proto_schluessel tut nichts'],
  [AM, "  abschluss_fehlt: (p) => { p.beats.pop(); return p; },", "  abschluss_fehlt: (p) => { return p; },", 'Mock: die Korruption abschluss_fehlt tut nichts'],
  // ---- Daten, Logbuch, Bericht, Werkzeug
  [AW, "\"cooldown_grenzen\": {\"wert\": 4,", "\"cooldown_grenzen\": {\"wert\": 1,", 'Daten: der Cooldown ist 1 (die Rechnung aus den Daten bleibt, der Test liest sie)'],
  [AW, "\"timeout_s\": {\"wert\": 120,", "\"timeout_s\": {\"wert\": 5000,", 'Daten: der Timeout ist unsinnig gross'],
  [AW, "\"antwort_max_zeichen\": {\"wert\": 6000,", "\"antwort_max_zeichen\": {\"wert\": 12000,", 'Daten: die Antwortgrenze liegt ueber dem Register'],
  [SJ, "\"figuren_neben\": {\"anbieter\": \"ollama\", \"modell\": null,", "\"figuren_neben\": {\"anbieter\": \"claude\", \"modell\": null,", 'Daten: figuren_neben liegt bei Claude'],
  [SJ, "    \"dank\": \"figuren_neben\",", "    \"dank\": \"geruechte_funk\",", 'Daten: der Slot dank gehoert der falschen Stufe'],
  [SJ, "    \"bauplan\": {\"anbieter\": \"claude\", \"modell\": \"sonnet\", \"eskalation\": false,", "    \"bauplan\": {\"anbieter\": \"claude\", \"modell\": \"sonnet\", \"eskalation\": true,", 'Daten: bauplan eskaliert standardmaessig'],
  [SY, "Der Katalog ist die Grenze", "Der Katalog ist ein Vorschlag", 'Systemprompt: Katalog = Grenze fehlt'],
  [RL, "'eskaliert', 'grund', 'geld']", "'eskaliert', 'grund']", 'Logbuch: das Feld geld wird verworfen'],
  [BR, "'lage_grobplan', 'abenteuer_bauplan']);", "'lage_grobplan']);", 'Bericht: die Tokens der Komposition zaehlen nicht in die Summe'],
  [BR, "    const aufrufe = ab.filter((e) => ['gueltig', 'abgelehnt', 'ausfall'].includes(e.ausgang));", "    const aufrufe = ab;", 'Bericht: uebersprungene Grenzen zaehlen als Aufruf'],
  [BR, "Math.round(geld * 10000) / 10000", "Math.round(geld * 10) / 10", 'Bericht: Geld ohne Nachkommastellen'],
  [BR, "`- Ablehnungen je Code: ${je(abgelehnt, (e) => e.grund || '?')}`", "`- Ablehnungen je Code: keine`", 'Bericht: die Ablehnungen je Code fehlen'],
  [BR, "`- Ausfälle je Code: ${je(aufrufe.filter((e) => e.ausgang === 'ausfall'), (e) => e.grund || '?')}`", "`- Ausfälle je Code: keine`", 'Bericht: die Ausfaelle je Code fehlen'],
  [BR, "`- Anbieter/Modell: ${je(aufrufe, (e) => (e.anbieter || '–') + '/' + (e.modell || '–'))}`", "`- Anbieter/Modell: –`", 'Bericht: Anbieter und Modell fehlen'],
  [BR, "p90 ${fmt(zahl(aufrufe.map((e) => e.dauer_s), 0.9), 10)} s`", "p90 ${fmt(zahl(aufrufe.map((e) => e.dauer_s), 0.5), 10)} s`", 'Bericht: p90 ist der Median'],
  [BR, "${ab.filter((e) => e.eskaliert || e.ausgang === 'eskaliert').length}, späte Antworten", "${0}, späte Antworten", 'Bericht: Eskalationen werden nicht gezaehlt'],
  [BR, "for (const e of ab.filter((x) => x.ausgang === 'uebersprungen')) { const g = e.grund || '?'; uebersprungen[g] = (uebersprungen[g] || 0) + 1; }", "", 'Bericht: uebersprungene Grenzen fehlen'],
  [ME, "function wiederholungen(folgen) { let n = 0; for (let i = 1; i < folgen.length; i++) if (folgen[i] === folgen[i - 1]) n++; return n; }", "function wiederholungen(folgen) { let n = 0; for (let i = 1; i < folgen.length; i++) if (folgen[i] !== folgen[i - 1]) n++; return n; }", 'Werkzeug: Wiederholungen falsch gezaehlt'],
  [ME, "const prozent = (a, b) => (b ? fmt((100 * a) / b, 10) + ' %' : '–');", "const prozent = (a, b) => (b ? fmt((100 * a) / b, 1) + ' %' : '–');", 'Werkzeug: Prozent ohne Nachkommastelle'],
  [ME, "    if (process.env.LLM_LIVE !== '1') {", "    if (false) {", 'Werkzeug: --live laeuft ohne LLM_LIVE=1'],
  [ME, "    if (!g0.ok) { console.log(`Messung Ollama: nicht gemessen", "    if (false) { console.log(`Messung Ollama: nicht gemessen", 'Werkzeug: --anbieter ollama prueft die Erreichbarkeit nicht'],
  [ME, "  if (anbieter !== undefined && !['claude', 'ollama'].includes(anbieter)) {", "  if (false) {", 'Werkzeug: ein unbekannter Anbieter wird angenommen'],
  [ME, "    N = Math.min(nArg || 10, 10);\n    const cli = LLM.claudeFinden();", "    N = nArg || 10;\n    const cli = LLM.claudeFinden();", 'Werkzeug: mehr als 10 echte Claude-Aufrufe'],
  [LP, "function planAusText(text) { return objektAusText(text, PLAN_KEYS); }", "function planAusText(text) { return objektAusText(text, []); }", 'Lage-Prompt: planAusText erkennt den Plan nicht mehr an seinen Schluesseln'],
];

// ---- Selbstcheck: jeder Anker genau einmal im Quelltext der Kopie (CRLF wie LF), sonst Exit 2. --trocken prueft nur die Anker (ohne Tests) und endet.
{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
const rot = (r) => r.status !== 0;
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-abenteuer.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER|✗/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, r = null;
  // der Test dieser Datei zuerst (schnell); die uebrigen Tests nur, wenn er die Mutation nicht erkennt
  for (const t of TESTS) { r = lauf(t); if (rot(r)) { wer = path.basename(t[0], '.js').replace('test-', ''); break; } }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER|✗/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*(FEHLER|✗)\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
