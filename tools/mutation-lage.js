'use strict';
// SUND-03 A2: Mutationsprobe zu tools/test-lage-spielleiter.js (Muster tools/mutation-regie.js). Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Regel des Lage-Spielleiters und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
// Abgedeckt: Grenzen (Hooks, Daten), Deckel, Mindestabstand, ein Job zugleich, Budget, Schalter, Timeout, Verwerfen später und veralteter Antworten, Rückfall, dispose, Prompt (Namensfilter, Größe,
// statischer Teil), Antwort lesen, Mock-Regisseur, Router, Bericht.
//   node tools/mutation-lage.js [begriff …]      (npm run test:lage-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-lage-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['test-lage-spielleiter.js', 'regie-fixture.js', 'regie-bericht.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }
const TESTS = [['tools/test-lage-spielleiter.js']];

const S = 'server/sim/lage-spielleiter.js', P = 'server/sim/lage-prompt.js', M = 'server/sim/lage-mock.js', G = 'server/game.js', K = 'server/sim/kriegslage.js', D = 'content/welt/lage-spielleiter-werte.json',
  BR = 'tools/regie-bericht.js', LL = 'server/mission/llm.js', RT = 'server/mission/transport-router.js', KT = 'content/welt/lage-katalog.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalente Mutanten): „die Antwort nach dispose wird nicht in den Eingang gelegt“ (update tut nach dispose nichts, der Eingang bleibt ungelesen).
const MUTATIONEN = [
  // ---- Grenzen
  [S, "    if (!this.W.grenzen.includes(art)) return { gestartet: false, grund: 'keine_grenze' };\n", "", 'Grenzen: jede Art löst aus (Daten ignoriert)'],
  [G, "if (this.lageSpielleiter) this.lageGrenze('andocken'); }", "}", 'Hook: Andocken löst nicht aus'],
  [G, "        if (!r && this.lageSpielleiter) this.lageGrenze('absicht');", "", 'Hook: Wahl/Ablehnung einer Option löst nicht aus'],
  [G, "        if (!r && this.lageSpielleiter) this.lageGrenze('absicht');", "        if (this.lageSpielleiter) this.lageGrenze('absicht');", 'Hook: auch eine abgelehnte Wahl löst aus'],
  [K, " && (wo || 'szene') === 'szene' && game.lageSpielleiter", " && game.lageSpielleiter", 'Hook: Posten und Notruf lösen als Szenenende aus'],
  [K, "  if (ev && (wo || 'szene') === 'szene' && game.lageSpielleiter && game.lageGrenze) game.lageGrenze('szene_ende');", "", 'Hook: Szenenende löst nicht aus'],
  [G, "      if (this.weltsim) this.safe('lage', () => this.lageUpdate(dt));", "", 'Game: der Lage-Spielleiter wird nie aktualisiert'],
  [G, "try { this.lageSpielleiter.dispose(); } catch (e) { this.countError('lage-dispose', e); }", "void 0;", 'Game: reset beendet den Lage-Spielleiter nicht'],
  // ---- Schalter
  [S, "return String(e.LAGE_SPIELLEITER || '') === '1' && String(e.SPIELLEITER_LLM || 'off').toLowerCase() !== 'off';", "return String(e.SPIELLEITER_LLM || 'off').toLowerCase() !== 'off';", 'Schalter: LAGE_SPIELLEITER wird nicht verlangt'],
  [S, "return String(e.LAGE_SPIELLEITER || '') === '1' && String(e.SPIELLEITER_LLM || 'off').toLowerCase() !== 'off';", "return String(e.LAGE_SPIELLEITER || '') === '1';", 'Schalter: SPIELLEITER_LLM=off wird ignoriert'],
  [S, "  if (m === 'live') return e.LLM_LIVE === '1' ? 'live' : 'off';", "  if (m === 'live') return 'live';", 'Modus: live ohne LLM_LIVE=1'],
  [S, "    if (this.mode === 'off' || (this.llm && this.llm.mode === 'off')) {", "    if (false) {", 'Schalter aus: der Spielleiter fragt trotzdem an'],
  [S, "      if (!this.ausGemeldet) { this.ausGemeldet = true;", "      if (!this.ausGemeldet) {", 'Schalter aus: Rückfall bei jeder Grenze'],
  // ---- Takt
  [S, "      if (this.aufrufe >= this.W.deckel_je_sitzung) return this.ueberspringen('deckel', art);\n", "", 'Deckel je Sitzung fehlt'],
  [S, "      if (this.letzterStartTick != null && ws.tickZahl - this.letzterStartTick < this.W.min_abstand_ticks) return this.ueberspringen('abstand', art);\n", "", 'Mindestabstand fehlt'],
  [S, "    this.letzterStartTick = ws.tickZahl;\n    this.zustand = 'angefragt';", "    this.zustand = 'angefragt';", 'Mindestabstand: Start wird nicht gemerkt'],
  [S, "    this.aufrufe++;\n", "", 'Deckel: Aufrufe werden nicht gezählt'],
  [S, "    if (this.zustand !== 'idle') return this.ueberspringen('beschaeftigt', art);\n", "", 'ein Job zugleich: zweite Anfrage während der ersten'],
  [S, "    if (b.remaining < this.W.min_budget) {", "    if (false) {", 'Budget: wird nicht geprüft'],
  [S, "    return this.pruefenUndVormerken('debug', true);", "    return this.pruefenUndVormerken('debug', false);", 'Debug plan: beachtet Abstand und Deckel'],
  [S, "    if (this.failNext) { this.failNext = false;", "    if (false) { this.failNext = false;", 'Debug fail: wirkt nicht'],
  // ---- Frist, späte und veraltete Antworten, Rückfall
  [S, "    if (this.game.time - job.start > this.W.timeout_s + 1) {", "    if (false) {", 'Timeout in Spielzeit fehlt'],
  [S, "      if (!job || job.token !== it.token) {", "      if (!job) {", 'späte Antwort: Token-Abgleich fehlt'],
  [S, "    if (alter > this.W.plan_alter_max_ticks) {", "    if (false) {", 'veralteter Plan wird gespielt'],
  [S, "    try { Regie.rueckfall(this.game, `${code}: ${String((e && e.message) || e).slice(0, 120)}`); } catch (err) { this.fehlerZaehlen('lage-rueckfall', err); }", "", 'Störung: kein Rückfall'],
  [S, "    if (!res.ok) return this.stoerung(job, LLM.llmError('EXIT', 'Plan ungültig: ' + res.grund), r);\n", "", 'ungültiger Plan gilt als angewandt'],
  [S, "    if (gelesen.fehler) return this.stoerung(job, LLM.llmError('EXIT', 'Antwort unbrauchbar: ' + gelesen.fehler), r);\n", "", 'unbrauchbare Antwort ohne eigene Störung'],
  [S, "    this.job = null; this.zustand = 'idle'; this.inbox = [];\n    if (inDerLuft", "    if (inDerLuft", 'dispose: Job bleibt stehen'],
  [S, "    if (inDerLuft && this.game.weltsim) {", "    if (false) {", 'dispose: kein Rückfall bei Anfrage in der Luft'],
  [S, "  bereit() { return !this.disposed && !!this.game.weltsim; }", "  bereit() { return !!this.game.weltsim; }", 'nach dispose arbeitet er weiter'],
  [S, "    while (this.letzte_plaene.length > this.W.letzte_plaene) this.letzte_plaene.shift();", "", 'letzte Pläne: Ringliste wächst'],
  [S, "    this.letzte_plaene.push(kurz);", "", 'letzte Pläne: werden nicht gemerkt'],
  [S, "      this.job = null; this.zustand = 'idle';\n      if (it.e)", "      if (it.e)", 'Abholen: Job bleibt nach der Antwort stehen'],
  // ---- Prompt
  [P, "'Crew');\n  return t;", "n);\n  return t;", 'Prompt: Namen bleiben im Text'],
  [P, "  const letzteTxt = namenFiltern(JSON.stringify(letzte || []), game);", "  const letzteTxt = JSON.stringify(letzte || []);", 'Prompt: Namen in den letzten Plänen'],
  [P, "  if (frei < werte.ausschnitt_min_zeichen) return", "  if (false) return", 'Prompt: zu wenig Platz wird nicht gemeldet'],
  [P, "const frei = Math.min(Ausschnitt.MAX_ZEICHEN, werte.prompt_max_zeichen - ohne.length);", "const frei = Ausschnitt.MAX_ZEICHEN;", 'Prompt: Obergrenze des ganzen Prompts fehlt'],
  [P, "  const prompt = LLM.buildPrompt({ katalog: st.text, variabel: [['ausschnitt', text], ['letzte_plaene', letzteTxt], ['grenze', JSON.stringify(grenze)]], schluss });", "  const prompt = LLM.buildPrompt({ variabel: [['ausschnitt', text], ['letzte_plaene', letzteTxt], ['grenze', JSON.stringify(grenze)], ['katalog', st.text]], schluss });", 'Prompt: der Katalog steht hinten'],
  [P, "  const zaun = t.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);\n  if (zaun && zaun[1].includes('{')) t = zaun[1];", "", 'Antwort: Zäune werden nicht entfernt'],
  [P, "roh.replace(/,\\s*([}\\]])/g, '$1')", "roh", 'Antwort: Komma vor der Klammer wird nicht repariert'],
  [P, "L.push(`- ${typ} { ${felder} } –", "L.push(`- ${typ} {} –", 'Katalog: Feldlisten fehlen'],
  [P, "for (const typ of Object.keys(FELDER).sort()) {", "for (const typ of Object.keys(FELDER).sort().slice(1)) {", 'Katalog: ein Befehl fehlt'],
  [P, "update(sys + '\\n\\n' + text)", "update(Date.now() + sys + text)", 'Katalog: der Hash des statischen Teils ändert sich je Aufruf'],
  [KT, '"fraktion": "rom|ger", "ziel": "Hex-Code"', '"fraktion": "rom|ger", "ziel_hex": "Hex-Code"', 'Katalogdaten: Feldname passt nicht zum Kern'],
  // ---- Mock-Regisseur
  [M, "      if (sieger === 'rom' || sieger === 'ger') plan.befehle.push(", "      if (true) plan.befehle.push(", 'Mock: Embargo auch bei offener Lage'],
  [M, "  const nr = Number.isInteger(g.nr) && g.nr > 0 ? g.nr : 1;", "  const nr = 1;", 'Mock: immer derselbe Plan'],
  [M, "const sw = sieger === 'rom' ? 'ger' : 'rom';", "const sw = 'zzz';", 'Mock: Befehle an eine unbekannte Fraktion'],
  // ---- llm.js und Router
  [LL, "const KINDS = ['grobplan', 'szene', 'text', 'lage'];", "const KINDS = ['grobplan', 'szene', 'text'];", 'llm: kind lage fehlt'],
  [LL, "      if (kind === 'lage') return { text: mockLage(input),", "      if (false) return { text: mockLage(input),", 'llm: mock bedient lage nicht'],
  [RT, "  if (art === 'lage' && anbieter === 'ollama') throw", "  if (false) throw", 'Router: lage darf an Ollama'],
  [RT, "lage: { anbieter: 'claude', modell: 'sonnet' } };\nconst STANDARD_ESKALATION", "lage: { anbieter: 'ollama' } };\nconst STANDARD_ESKALATION", 'Router: lage geht standardmäßig an Ollama'],
  // ---- Daten
  [D, '"deckel_je_sitzung": {"wert": 6', '"deckel_je_sitzung": {"wert": 60', 'Daten: Deckel 60 statt 6'],
  [D, '"grenzen": {"wert": ["szene_ende", "andocken", "absicht"]', '"grenzen": {"wert": ["szene_ende", "andocken"]', 'Daten: Grenze absicht fehlt'],
  // ---- Bericht
  [BR, "Rückfälle: ${lageRueck.length}", "Rückfälle: 0", 'Bericht: Rückfälle der Lage'],
  [BR, "const aufrufe = lage.filter((e) => ['angewandt', 'fehler', 'veraltet'].includes(e.ausgang)", "const aufrufe = lage.filter((e) => ['angewandt'].includes(e.ausgang)", 'Bericht: Fehler zählen nicht als Aufruf'],
  [BR, "const CALLS = new Set(['grobplan', 'szene', 'verspaetet', 'lage_grobplan']);", "const CALLS = new Set(['grobplan', 'szene', 'verspaetet']);", 'Bericht: Tokens der Lage fehlen in der Summe'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
const rot = (r) => r.status !== 0;
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-lage-spielleiter.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
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
  for (const t of TESTS) { r = lauf(t); if (rot(r)) { wer = path.basename(t[0], '.js').replace('test-', ''); break; } }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
