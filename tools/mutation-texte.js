'use strict';
// SUND-03b T: Mutationsprobe zu tools/test-texte-pool.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel der Live-Texte
// (Pool, Prüfer, Prompt, Daten, Einhängestellen) und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
// Mit Anker-Selbstcheck: VOR dem ersten Lauf muss jeder Anker genau einmal im Quelltext der Kopie stehen, sonst bricht die Probe mit Exit 2 ab (--trocken prüft nur die Anker).
//   node tools/mutation-texte.js [begriff …] [--trocken]      (npm run test:texte-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-texte-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-texte-pool.js']];
for (const f of ['tools/test-texte-pool.js', 'tools/regie-fixture.js', 'tools/transport-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const TP = 'server/sim/texte-pool.js', TR = 'server/sim/texte-pruefer.js', RE = 'server/sim/reise-ereignis.js', RB = 'server/sim/regie-befehle.js', WI = 'server/sim/kriegslage-wissen.js', GA = 'server/game.js', KL = 'server/sim/kriegslage.js',
  DT = 'content/texte/texte-werte.json', SP = 'content/spielleiter/prompts/text.system.md';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Pool: verbrauchen, Reihenfolge
  [TP, "  return l.shift();\n}", "  return l[0];\n}", 'Pool: ein Text wird nicht verbraucht (mehrfach geliefert)'],
  [TP, "  return l.shift();\n}", "  return l.pop();\n}", 'Pool: nicht FIFO (der jüngste zuerst)'],
  [TP, "  S.zaehler.verbraucht++;\n", "", 'Pool: Verbrauch wird nicht gezählt'],
  [TP, "function poolEntnehmen(art, id, slot, optionId) {\n  const l = S.pool.get(keyVon(art, id, slot, optionId));", "function poolEntnehmen(art, id, slot, optionId) {\n  const l = S.pool.get(keyVon(art, id, slot));", 'Pool: die Option gehört nicht zum Schlüssel'],
  [TP, "const keyVon = (art, id, slot, optionId) => [art, id, slot, optionId || ''].join('|');", "const keyVon = (art, id, slot, optionId) => [art, id, optionId || ''].join('|');", 'Pool: der Slot gehört nicht zum Schlüssel'],
  // ---- Takt
  [TP, "    if (S.job) return;\n    S.leer += Number(dt) || 0;", "    S.leer += Number(dt) || 0;", 'Takt: mehrere Text-Jobs zugleich'],
  [TP, "    if (!(S.angestossen || S.leer >= W.leerlauf_s)) return;\n", "", 'Takt: kein Leerlauf, jeder Schritt startet einen Job'],
  [TP, "    S.angestossen = true;\n    return true;", "    return true;", 'Takt: die Tätigkeitsgrenze stößt nichts an'],
  [TP, "    if (S.zeit < S.pauseBis) return;\n", "", 'Takt: Dauerfeuer auf einen toten Dienst (keine Pause)'],
  [TP, "W.fehler_pause_s.start * Math.pow(2, S.fehlerFolge - 1)", "W.fehler_pause_s.start", 'Takt: die Pause verdoppelt sich nicht'],
  [TP, "      z.fehler++;\n      S.fehlerFolge++;", "      z.fehler++;", 'Takt: die Fehlerfolge wird nicht gezählt'],
  [TP, "  S.job = { key: n.key, zeit: S.zeit };\n  S.angestossen = false;", "  S.job = null;\n  S.angestossen = false;", 'Takt: der laufende Job wird nicht vermerkt'],
  [TP, "  ).then((erg) => { S.job = null; S.leer = 0; S.angestossen = false; try", "  ).then((erg) => { S.job = null; S.angestossen = false; try", 'Takt: nach dem Job beginnt der Leerlauf nicht neu'],
  [TP, "  ).then((erg) => { S.job = null; S.leer = 0; S.angestossen = false; try", "  ).then((erg) => { S.job = null; S.leer = 0; try", 'Takt: eine Grenze während des Jobs löst sofort den nächsten aus'],
  [TP, "    if (n >= (sp.ziel || W.ziel)) continue;", "    if (n >= 1) continue;", 'Pool: nur ein Text je Schlüssel statt des Ziels'],
  [TP, "    if (n >= (sp.ziel || W.ziel)) continue;", "    if (n >= (sp.ziel || W.ziel) + 5) continue;", 'Pool: füllt über das Ziel hinaus'],
  [TP, "  if (gesamt() >= W.gesamt_max) return null;\n", "", 'Pool: keine Obergrenze'],
  [TP, "    if (!best || n < best.n) best = { key, sp, n };", "    if (!best) best = { key, sp, n };", 'Pool: füllt nicht den am wenigsten gefüllten Schlüssel zuerst'],
  [TP, "    if ((S.schluesselPause.get(key) || 0) > S.zeit) continue;\n", "", 'Pool: ein Schlüssel mit Müll wird sofort wieder versucht'],
  [TP, "S.schluesselPause.set(key, S.zeit + W.schluessel_pause_s); S.fehlerFolge = 0; }", "S.fehlerFolge = 0; }", 'Pool: der Schlüssel mit Müll pausiert nicht'],
  [TP, "  for (let v = 1; v <= Math.max(1, W.versuche); v++) {", "  for (let v = 1; v <= 1; v++) {", 'Wiederholung: es gibt keinen Wiederholungsversuch'],
  [DT, '"versuche": {"wert": 2', '"versuche": {"wert": 3', 'Daten: zwei Wiederholungsversuche statt einem'],
  [TP, "    vorher = { antwort: r.text, fehler: p.fehler };\n", "", 'Wiederholung: die Fehler des Prüfers gehen nicht in den Prompt'],
  [TP, "{ timeoutMs: W.job_timeout_s * 1000, schema: Pruefer.schemaFuer(spec.slot) }", "{ schema: Pruefer.schemaFuer(spec.slot) }", 'Transport: kein Zeitlimit'],
  [TP, "{ timeoutMs: W.job_timeout_s * 1000, schema: Pruefer.schemaFuer(spec.slot) }", "{ timeoutMs: W.job_timeout_s * 1000 }", 'Transport: kein Schema (format)'],
  [TP, "vorhanden: (opt.vorhanden || []).concat(spec.beispiele || []), muss", "vorhanden: opt.vorhanden, muss", 'Prüfer: abgeschriebene Katalogtexte werden nicht erkannt'],
  [TP, "  const namen = Ausschnitt.spielerNamen(game);\n  let vorher = null;", "  const namen = [];\n  let vorher = null;", 'Namen: der Prompt filtert keine Spielernamen'],
  [TP, "  const prompt = Pruefer.promptBauen(sp, { vorhanden: opt.vorhanden, vorher: opt.vorher });", "  const prompt = Pruefer.promptBauen(sp, { vorher: opt.vorher });", 'Prompt: die schon vorhandenen Texte fehlen'],
  // ---- Transport nur Ollama, nie Claude
  [TP, "{ eskalation: null, env });   // nur Ollama", "{ env });   // nur Ollama", 'Claude: der Router eskaliert an Claude'],
  [TP, "Router.routeTransport({ text: { anbieter: 'ollama', modell } }", "Router.routeTransport({ text: { anbieter: 'claude', modell } }", 'Claude: Texte gehen an Claude'],
  [TP, "const modus = (env) => (String(((env || process.env) || {}).LLM_LIVE || '') === '1' ? 'live' : 'off');", "const modus = (env) => 'live';", 'Modus: auch ohne LLM_LIVE=1 wird erzeugt'],
  [TP, "  if (modus(env) !== 'live') return null;\n", "", 'Modus: getLlm prüft den Modus nicht'],
  // ---- Schalter
  [TP, "  return W.standard_an === true;\n}\nconst modus", "  return true;\n}\nconst modus", 'Schalter: Standard an'],
  [TP, "  if (v === '0' || v === 'off') return false;\n  return W.standard_an", "  if (v === '0') return false;\n  return W.standard_an", 'Schalter: off schaltet nicht aus'],
  [TP, "    S.freigabe = aktiv(game);   // der zuletzt", "    S.freigabe = true;   // der zuletzt", 'Schalter: ein Raum ohne Schalter gibt den Pool frei'],
  [TP, "    S.freigabe = aktiv(game);   // der zuletzt laufende Raum entscheidet, ob der Pool gelesen werden darf (der Schalter ist sonst prozessweit)\n    if (!S.freigabe) return;", "    S.freigabe = aktiv(game);   // der zuletzt laufende Raum entscheidet, ob der Pool gelesen werden darf (der Schalter ist sonst prozessweit)", 'Schalter: update erzeugt auch ohne Schalter'],
  [TP, "    S.freigabe = aktiv(game);\n    if (!S.freigabe) return false;", "    S.freigabe = aktiv(game);", 'Schalter: beiGrenze arbeitet auch ohne Schalter'],
  [TP, "  if (game ? !aktiv(game) : !freigegeben()) return null;", "  if (game ? false : !freigegeben()) return null;", 'Schalter: der Raum ohne Schalter bekommt Pool-Text (poolFuer, poolText)'],
  [TP, "  if (game) { const namen = Ausschnitt.spielerNamen(game); if (namen && namen.length && Ausschnitt.ohneNamen(t, namen) !== t) return null; }\n", "", 'Namen: ein Pooltext mit Spielername des ziehenden Raums wird gesendet'],
  // ---- Anmeldung (Schnittstelle für Paket A)
  [TP, "|| !SLOTS.includes(sp.slot)) return", "|| false) return", 'Anmeldung: unbekannte Slots werden angenommen'],
  [TP, "  if (!str(sp.fakt)) return { ok: false", "  if (false) return { ok: false", 'Anmeldung: ohne Fakt wird angenommen'],
  [TP, "platzhalter: liste(sp.platzhalter).filter((p) => W.platzhalter_erlaubt.includes(p)),", "platzhalter: liste(sp.platzhalter),", 'Anmeldung: beliebige Platzhalter werden erlaubt'],
  [TP, "    ziel: klemme(Math.floor(Number(sp.ziel)) || W.ziel, 1, 5),", "    ziel: W.ziel,", 'Anmeldung: das Ziel der Anmeldung zählt nicht'],
  [TP, "  if (str(sp.option)) norm.option = sp.option;\n", "", 'Anmeldung: die Absicht der Option geht verloren'],
  [TP, "  if (str(sp.antwort)) norm.antwort = sp.antwort;\n", "", 'Anmeldung: die Antwort der Spieler geht verloren'],
  [TP, "      const pflicht = erlaubt.filter((p) => mengen.every((m) => m.has(p)));", "      const pflicht = [];", 'Katalog: Pflicht-Platzhalter fehlen'],
  [TP, "const erlaubt = [...new Set(mengen.flatMap((m) => [...m]))].filter((p) => W.platzhalter_erlaubt.includes(p));", "const erlaubt = ['ort', 'n'];", 'Katalog: alle Platzhalter überall erlaubt'],
  // ---- Prüfer
  [TR, "  if (t.length < s.min) fehler.push(", "  if (false) fehler.push(", 'Prüfer: Mindestlänge'],
  [TR, "  if (t.length > s.max) fehler.push(", "  if (false) fehler.push(", 'Prüfer: Höchstlänge'],
  [TR, "  if (/\\{\\{|\\}\\}/.test(t)) fehler.push(", "  if (false) fehler.push(", 'Prüfer: doppelte Klammern {{…}}'],
  [TR, "if (!erlaubt.has(m[1])) fehler.push(", "if (false) fehler.push(", 'Prüfer: nicht erlaubte Platzhalter'],
  [TR, "  for (const p of c.pflicht || []) if (!gefunden.has(p)) fehler.push(", "  for (const p of []) if (!gefunden.has(p)) fehler.push(", 'Prüfer: Pflicht-Platzhalter'],
  [TR, "  if (/[{}]/.test(t.replace(/\\{\\w+\\}/g, ''))) fehler.push(", "  if (false) fehler.push(", 'Prüfer: lose Klammern'],
  [TR, "  if (/[\\n\\r<>*_#`\\[\\]|\\\\]/.test(t)) fehler.push(", "  if (false) fehler.push(", 'Prüfer: Markdown und Sonderzeichen'],
  [TR, "  if (/[\\u{1F000}-\\u{1FFFF}\\u{2600}-\\u{27BF}]/u.test(t)) fehler.push(", "  if (false) fehler.push(", 'Prüfer: Emoji'],
  [TR, "  if (!WERTE.ziffern_erlaubt && /\\d/.test(t)) fehler.push(", "  if (false) fehler.push(", 'Prüfer: Ziffern'],
  [TR, "  if (s.satzende !== false && !/[.!?…]", "  if (!/[.!?…]", 'Prüfer: Optionstexte brauchen ein Satzende'],
  [TR, "  if (s.satzende !== false && !/[.!?…][“”\"»«]?$/.test(t)) fehler.push(", "  if (false) fehler.push(", 'Prüfer: Satzende'],
  [TR, "  if (c.namen && c.namen.length && Ausschnitt.ohneNamen(t, c.namen) !== t) fehler.push(", "  if (false) fehler.push(", 'Prüfer: Spielernamen im Text'],
  [TR, "    if (!v.slots.includes(c.slot)) continue;\n", "", 'Prüfer: verbotene Gruppen gelten für alle Slots'],
  [TR, "    const m = v.re.exec(t);\n    if (m) fehler.push(", "    const m = null;\n    if (m) fehler.push(", 'Prüfer: verbotene Wörter'],
  [TR, "  if (fremd) fehler.push(", "  if (false) fehler.push(", 'Prüfer: die Stimme (Germane klingt nicht römisch)'],
  [TR, "  for (const m of c.muss || []) if (!regex(m).test(t)) fehler.push(", "  for (const m of []) if (!regex(m).test(t)) fehler.push(", 'Prüfer: Pflichtwörter des Eintrags'],
  [TR, "  for (const m of c.nicht || []) { const x = regex(m).exec(t); if (x) fehler.push(", "  for (const m of []) { const x = regex(m).exec(t); if (x) fehler.push(", 'Prüfer: verbotene Wörter des Eintrags'],
  [TR, "if (c.vorhanden.some((v) => normal(v) === n)) fehler.push(", "if (false) fehler.push(", 'Prüfer: Duplikate'],
  [TR, "  if (typeof text !== 'string') return { ok: false, text: '', fehler: ['kein Text'] };", "", 'Prüfer: Müll ohne Text wirft'],
  [TR, "  for (const [a, b] of paare) if (t.length > 2 &&", "  for (const [a, b] of []) if (t.length > 2 &&", 'Prüfer: äußere Anführungszeichen bleiben stehen'],
  [TR, "  t = t.replace(/^```(?:json)?\\s*/i, '').replace(/\\s*```$/, '');\n", "", 'Antwort: Codezäune werden nicht abgestreift'],
  [TR, "return o && typeof o.text === 'string' ? o.text : null;", "return o && o.text ? String(o.text) : null;", 'Antwort: ein Text, der kein String ist, wird angenommen'],
  // ---- Prompt
  [TR, "const filter = (x, namen) => (namen && namen.length ? Ausschnitt.ohneNamen(x, namen) : String(x == null ? '' : x));", "const filter = (x, namen) => String(x == null ? '' : x);", 'Prompt: Freitext läuft nicht durch den Namensfilter'],
  [TR, "  if (spec.antwort) out.push(`<spieler_antwort>", "  if (false) out.push(`<spieler_antwort>", 'Prompt: die Antwort der Spieler fehlt'],
  [TR, "  if (spec.option) out.push(`<option>", "  if (false) out.push(`<option>", 'Prompt: die Absicht der Option fehlt'],
  [TR, "Länge: ${s.min} bis ${s.max} Zeichen.", "Länge: ${s.min} bis ${s.max + 40} Zeichen.", 'Prompt: falsche Obergrenze'],
  [TR, "  const bsp = (spec.beispiele || []).slice(0, WERTE.beispiele_max);", "  const bsp = [];", 'Prompt: keine Stilvorlagen'],
  [TR, "    out.push(`<pruefer>\\n${(opt.vorher.fehler || []).map((e) => '- ' + e).join('\\n')}\\n</pruefer>`);", "", 'Prompt: die Prüferfehler fehlen bei der Wiederholung'],
  // ---- Einhängestellen
  [RE, "  const live = TextePool.poolFuer(game, 'reise', e.id, slot);", "  const live = null;", 'textFuer: liest den Pool nicht'],
  [RE, "  const live = TextePool.poolFuer(game, 'reise', e.id, slot);", "  const live = TextePool.poolEntnehmen('reise', e.id, slot);", 'textFuer: fragt den Schalter nicht (prozessweite Freigabe statt Raum)'],
  [RE, "  const live = TextePool.poolFuer(game, 'reise', e.id, slot);", "  const live = TextePool.poolFuer(undefined, 'reise', e.id, slot);", 'textFuer: der Raum wird nicht durchgereicht (Schalter und Namensfilter des Raums fehlen)'],
  [RE, "fmt(live != null ? live : liste[(ev.textIdx || 0) % liste.length], werte)", "fmt(liste[(ev.textIdx || 0) % liste.length], werte)", 'textFuer: der Pool-Text ersetzt den Katalogtext nicht'],
  [RE, "  const werte = { ort: hexName(ev.hex), n: (e.parameter || {}).vorlauf_s };", "  const werte = { ort: hexName(ev.hex) };", 'textFuer: {n} bleibt im Pool-Text stehen'],
  [RE, "  const live = TextePool.poolFuer(game, 'reise', e.id, slot);", "  const live = TextePool.poolFuer(game, 'reise', ev.id + 'x', slot);", 'textFuer: falscher Schlüssel'],
  [RB, "  if (!ev || ev.typ !== 'soeldner_vermietet') return null;", "  if (!ev || ev.typ !== 'soeldner_vermietet' || !TextePool.aktiv(game)) return null;", 'Söldner: der Pool-Schalter entscheidet, ob gefunkt wird (nicht nur den Text)'],
  [RB, "if (spielleiterAn(game)) out.soeldner =", "out.soeldner =", 'Söldner: Funk auch ohne Lage-Spielleiter'],
  [RB, "  for (const f of funk) funkSenden(game, f);\n  for (const a of out.angenommen.filter((x) => !x._faden)) schreibe(", "  for (const a of out.angenommen) { const f = soeldnerFunk(game, { typ: 'soeldner_vermietet', an: a.befehl.an, flotten: (a.befehl.flotten || []).length }); if (a.befehl.typ === 'soeldner' && f) funk.push(f); }\n  for (const f of funk) funkSenden(game, f);\n  for (const a of out.angenommen.filter((x) => !x._faden)) schreibe(", 'Söldner: der Funk kommt schon beim Vormerken des Befehls'],
  [RB, "  const reich = ev.an === 'ger' ? 'ger' : 'rom';", "  const reich = 'rom';", 'Söldner: immer der Pool und Text für Rom'],
  [RB, "  for (const ev of aus.soeldner || []) funkSenden(game, soeldnerFunk(game, ev));\n", "", 'Söldner: nach dem Sim-Ereignis kommt kein Funk'],
  [RB, "  const text = live != null ? live : (kat && kat.text ? fmt(kat.text, werte) : null);", "  const text = live != null ? live : null;", 'Söldner: kein Katalogtext als Rückfall'],
  [WI, "verlust: { id: posten ? 'posten_verloren' : 'hafen_gefallen', ort: hexName(d, ev.h) }, ", "", 'Verlust: der Lagefunk meldet seinen Pool-Schlüssel nicht'],
  [WI, "      if (live != null) f.text = live;\n", "", 'Verlust: der Pool-Text ersetzt die Vorlage nicht'],
  [WI, "id: posten ? 'posten_verloren' : 'hafen_gefallen', ort:", "id: posten ? 'hafen_gefallen' : 'posten_verloren', ort:", 'Verlust: Posten- und Hafenspruch vertauscht'],
  [WI, "const live = f.verlust ? TextePool.poolText(game, 'lage', f.verlust.id, 'verlust', { ort: f.verlust.ort }) : null;", "const live = f.verlust ? TextePool.poolText(game, 'lage', f.verlust.id, 'verlust', {}) : null;", 'Verlust: {ort} bleibt im Text stehen'],
  [GA, "    TextePool.beiGrenze(this, art);   // SUND-03b T", "    void art;   // SUND-03b T", 'Hook: game.lageGrenze stößt den Pool nicht an'],
  [GA, "  texteUpdate(dt) { TextePool.update(this, dt); }", "  texteUpdate(dt) { void dt; }", 'Hook: der Step treibt den Pool nicht'],
  [GA, "      if (this.weltsim) this.safe('texte', () => this.texteUpdate(dt));", "      void 0;", 'Hook: der Step ruft texteUpdate nicht'],
  [GA, "if (name === 'docked') { this.markSaveDue('docked'); this.lageGrenze('andocken'); }", "if (name === 'docked') { this.markSaveDue('docked'); if (this.lageSpielleiter) this.lageGrenze('andocken'); }", 'Hook: Andocken ist ohne Lage-Spielleiter keine Grenze für den Pool'],
  [KL, "if (ev && (wo || 'szene') === 'szene' && game.lageGrenze) game.lageGrenze('szene_ende');", "if (ev && (wo || 'szene') === 'szene' && game.lageSpielleiter && game.lageGrenze) game.lageGrenze('szene_ende');", 'Hook: Szenenende ist ohne Lage-Spielleiter keine Grenze für den Pool'],
  // ---- Daten
  [DT, '"standard_an": {"wert": false', '"standard_an": {"wert": true', 'Daten: Standard an'],
  [DT, '"ziel": {"wert": 3', '"ziel": {"wert": 1', 'Daten: Ziel 1 Variante'],
  [DT, '"versuche": {"wert": 2', '"versuche": {"wert": 1', 'Daten: ein Versuch'],
  [DT, '"antwort": {"min": 8, "max": 40,', '"antwort": {"min": 8, "max": 90,', 'Daten: Optionstext bis 90 Zeichen'],
  [DT, '"ziffern_erlaubt": {"wert": false', '"ziffern_erlaubt": {"wert": true', 'Daten: Ziffern erlaubt'],
  [DT, '|spring|', '|', 'Daten: „spring“ ist nicht verboten'],
  [DT, 'ueberrannt|überrannt|', '', 'Daten: „überrannt“ ist nicht verboten'],
  [DT, '"muster": "^\\\\s*(Meldung|Es wird gemeldet|Hiermit|Achtung, Meldung)|keine weiteren|', '"muster": "^\\\\s*(Meldung|Es wird gemeldet|Hiermit|Achtung, Meldung)|', 'Daten: Meldungston „keine weiteren Informationen“'],
  [DT, 'Streife|Hafenwacht|Posten\\\\b|Legat|Legion|Centurio', 'Hafenwacht|Posten\\\\b|Legat|Centurio', 'Daten: der Germane darf Streife und Legion sagen'],
  [DT, '"muss": ["Posten"], "nicht": ["Hafen"]', '"muss": [], "nicht": []', 'Daten: Posten- und Hafenspruch nicht getrennt'],
  [DT, '"slots": ["verlust"], "_hinweis": "Wer den Ort jetzt haelt', '"slots": [], "_hinweis": "Wer den Ort jetzt haelt', 'Daten: der Verlustspruch darf einen Sieger nennen'],
  [DT, "weicht aus|", "", "Daten S3: „Weicht aus“ ist nicht verboten"],
  [DT, "dreht ab|", "", "Daten S3: „Dreht ab“ ist nicht verboten"],
  [DT, "kehrt um|", "", "Daten S3: „Kehrt um“ ist nicht verboten"],
  [DT, "zieht euch zurück|", "", "Daten S3: „Zieht euch zurück“ ist nicht verboten"],
  [DT, "macht euch davon|", "", "Daten S3: „Macht euch davon“ ist nicht verboten"],
  [DT, "haltet abstand|", "", "Daten S3: „Haltet Abstand“ ist nicht verboten (lasst sie ziehen bleibt)"],
  [DT, "lasst sie ziehen|", "", "Daten S3: „lasst sie ziehen“ ist nicht verboten (haltet Abstand bleibt)"],
  [DT, "übernommen|uebernommen|germane|römer|roemer|feind|", "übernommen|uebernommen|römer|roemer|", "Daten S3: der Verlustspruch darf Germanen und den Feind nennen"],
  [DT, "|(halten|hält|haelt|hielt|hielten) +(ihn|sie|es|den|die|das|dort|jetzt)", "", "Daten S3: der Verlustspruch darf sagen, wer den Ort hält"],
  [DT, "\"erobert|besetz|eingenommen|", "\"erobert|eingenommen|", "Daten S3: der Verlustspruch darf „besetzt“ sagen"],
  [DT, "\"(?<![a-zäöüß])tot(e|en|er)?(?![a-zäöüß])|sterben|", "\"sterben|", "Daten S3: „alle tot“ im Verlustspruch ist erlaubt"],
  [DT, "überleb|ueberleb|", "", "Daten S3: „überlebt“ im Verlustspruch ist erlaubt"],
  [DT, "\"slots\": [\"verlust\"], \"_hinweis\": \"Kein erfundenes", "\"slots\": [], \"_hinweis\": \"Kein erfundenes", "Daten S3: die Gruppe besatzung gilt für keinen Slot"],
  [SP, 'Rate nie zum Springen, Ausweichen, Fliehen oder Umfliegen', 'Rate zum Springen, Ausweichen, Fliehen oder Umfliegen', 'Systemprompt: rät zum Ausweichen'],
];

// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie). Sonst Exit 2, statt eine Mutation still zu überspringen. --trocken: nur die Anker.
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
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-texte-pool.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, r = null;
  for (const t of TESTS) { r = lauf(t); if (r.status !== 0) { wer = path.basename(t[0], '.js').replace('test-', ''); break; } }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
