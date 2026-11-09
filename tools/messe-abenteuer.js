'use strict';
// SUND-04b A2: Messwerkzeug der Abenteuer-Komposition (server/sim/abenteuer-spielleiter.js). Laesst N Aufrufe durch die echte Kette laufen (Prompt -> Antwort -> Lesen -> expandiere -> Pruefer -> abenteuerAnbieten)
// und gibt aus: Gueltigkeit, Ablehnquote je Code, Wiederholungsrate (gleiche Typenfolge wie die vorige lesbare Antwort), Tokens, Dauer, Geld.
//   node tools/messe-abenteuer.js [--n 200]                                  Mock, ohne Netz (Standard N=200)
//   node tools/messe-abenteuer.js --live [--n 10]                            bis zu 10 echte Claude-Aufrufe; nur mit LLM_LIVE=1 UND gefundener CLI, sonst uebersprungen (nicht gemessen)
//   node tools/messe-abenteuer.js --anbieter ollama --modell <m> [--n 10]    anderer Anbieter (Ollama auf Sleipnir ueber den ssh-Tunnel, OLLAMA_URL, Standard http://127.0.0.1:11435); nur wenn erreichbar, sonst uebersprungen
//   node tools/messe-abenteuer.js --anbieter claude --modell <m>             Claude mit anderem Modell (wie --live, braucht LLM_LIVE=1)
//   node tools/messe-abenteuer.js --mock                                     ausdruecklich Mock (Standard; nicht mit --live/--anbieter)
//   node tools/messe-abenteuer.js ... --out <ordner>                         LIV-01 C: Ablage jedes Plans (siehe unten); ohne --out bleibt alles wie bisher (nur Konsole)
// --out <ordner>: legt unter <ordner> (relativ zum Aufrufer, NIE im Repo, nie geloescht) einen neuen Lauf-Ordner abenteuer-<Zeit>-<modus> an mit
//   plan-NN.md (je Aufruf: Frontmatter Aufruf-Nr, Zeit, Dauer, Tokens, Kosten, Gueltigkeit, Pruefer-Befunde, Rueckfall, Modell/Anbieter; Body: lesbarer Plan, Rohantwort, Logbuch-Eintrag),
//   plan-NN.prompt.txt (der Prompt), index.md (Tabelle mit Links, Zusammenfassung: Gueltigkeit, Dauer Median/p90, Tokens gegen CLAUDE_TOKEN_BUDGET, Kosten, Wiederholungen/Duplikate),
//   messung.json (Rohdaten) und regie/ (REGIE_DIR des Spiels) samt aufnahmen/ (recordDir des LLM, nur live). REGIE_DIR und MITSCHNITT(_DIR) aus der Umgebung gelten, wenn gesetzt.
//   Die Test-Fixture setzt REGIE_DIR auf einen Temp-Ordner, solange das Werkzeug es nicht im env des Spiels vorgibt: das tut --out (nur im Werkzeug, nicht im Spielcode).
// Obergrenze: Claude hoechstens 10 Aufrufe je Lauf (aufrufZahl: Math.min(n || 10, 10), kostet Geld), Ollama 50, Mock 5000. Das ist absichtlich hart; mehr Aufrufe nur mit mehreren Laeufen und Absprache.
// Exit 0 (auch bei uebersprungenen Messungen: die Meldung steht in der Ausgabe), Exit 2 bei falschem Aufruf. Die Messwerte der echten Anbieter sind nur so gut wie die Zahl der Aufrufe: ab 10 Aufrufen aussagekraeftig, nicht mehr.
const path = require('path');
const START_CWD = process.cwd();   // --out ist relativ zum Aufrufer, nicht zum Repo
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const LLM = require('../server/mission/llm.js');
const Router = require('../server/mission/transport-router.js');
const Ollama = require('../server/mission/transport-ollama.js');
const LS = require('../server/sim/lage-spielleiter.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const Faden = require('../server/sim/faden.js');
const Ablage = require('./messe-ablage.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const fmt = (x, d) => (Number.isFinite(x) ? (Math.round(x * (d || 1)) / (d || 1)).toLocaleString('de-DE') : '–');
const prozent = (a, b) => (b ? fmt((100 * a) / b, 10) + ' %' : '–');
const frei = () => new Promise((r) => setImmediate(r));

const live = flag('live');
const mockFlag = flag('mock');
const outArg = wert('out');
const anbieter = wert('anbieter');
const modell = wert('modell');
const nArg = wert('n') !== undefined ? Number(wert('n')) : null;
let ausgabeWurzel = null;
function aufrufPruefen() {
  if (mockFlag && (live || anbieter !== undefined)) { console.error('--mock gilt nicht zusammen mit --live oder --anbieter'); process.exit(2); }
  if (args.includes('--out')) {
    try { ausgabeWurzel = Ablage.wurzelPruefen(outArg && !outArg.startsWith('--') ? outArg : '', START_CWD); } catch (e) { console.error(e.message); process.exit(2); }
  }
  if (anbieter !== undefined && !['claude', 'ollama'].includes(anbieter)) { console.error(`unbekannter Anbieter "${anbieter}" (erlaubt: claude, ollama)`); process.exit(2); }
  if (nArg !== null && !(Number.isInteger(nArg) && nArg >= 1 && nArg <= 5000)) { console.error('--n: ganze Zahl 1 bis 5000'); process.exit(2); }
}

// Anzahl der Aufrufe: Mock beliebig (Standard 200), Claude hoechstens 10 (kostet Geld), Ollama hoechstens 50
// Konsolenzeile der Dauer: derselbe Median wie in index.md (Ablage.median, bei gerader Anzahl der Mittelwert der beiden mittleren), nicht dauer[floor(n/2)]
function dauerText(dauer) { return `Median ${fmt(Ablage.median(dauer), 100)} s, max ${fmt(dauer.length ? Math.max(...dauer) : null, 100)} s`; }
function aufrufZahl(modus, n) { return modus === 'claude' ? Math.min(n || 10, 10) : modus === 'ollama' ? Math.min(n || 10, 50) : (n || 200); }
// gleiche Typenfolge wie die vorige: Anzahl der Wiederholungen hintereinander
function wiederholungen(folgen) { let n = 0; for (let i = 1; i < folgen.length; i++) if (folgen[i] === folgen[i - 1]) n++; return n; }

// ---------- LIV-01 C: Ablage (nur mit --out)
const nn = (n) => String(n).padStart(2, '0');
const planDatei = (n) => `plan-${nn(n)}.md`;
function planMarkdown(p, ctx) {
  const e = p.eintrag, a0 = p.aufrufe[0], a1 = p.aufrufe[p.aufrufe.length - 1];
  const antwort = a1 && a1.antwort, titel = p.gelesen && p.gelesen.plan && p.gelesen.plan.titel;
  const fm = {
    aufruf: p.nr, zeit: a0 ? a0.start : null, dauer_s: e ? e.dauer_s : null, tokens: e ? e.tokens : 0,
    kosten_usd: e && Number.isFinite(e.geld) && ctx.modus === 'live' ? e.geld : null, gueltigkeit: e ? e.ausgang : 'kein_ergebnis', grund: e && e.grund ? e.grund : null,
    pruefer_befunde: e && Array.isArray(e.fehler) ? e.fehler : [], rueckfall: false, anbieter: e ? e.anbieter : null, modell: e ? e.modell : null, quelle: e ? e.quelle : null,
    key: antwort && antwort.key ? antwort.key : null, cli: antwort && antwort.cli ? antwort.cli.quelle : null, aufnahme: ctx.modus === 'live' && antwort && antwort.key ? `regie/aufnahmen/abenteuer/${antwort.key}.json` : null, prompt_datei: `plan-${nn(p.nr)}.prompt.txt`, modus: ctx.modus,
  };
  const L = [Ablage.frontmatter(fm), `# Aufruf ${p.nr}: ${titel || (e ? e.ausgang : 'kein Ergebnis')}`, ''];
  L.push(`[zurück zum Index](index.md) · [Prompt](plan-${nn(p.nr)}.prompt.txt)`, '');
  L.push('Rückfall: nein (bei Ablehnung oder Ausfall entsteht aus diesem Aufruf kein Angebot; der Anschluss-Standardplan des Bretts ist ein eigener Logbuch-Eintrag).', '');
  L.push('## Plan', '', Ablage.planLesbar(p.gelesen));
  if (e && e.ausgang !== 'gueltig') L.push('## Prüfer-Befund', '', `${e.ausgang} (${e.grund || '–'})`, '', ...(Array.isArray(e.fehler) ? e.fehler.map((f) => '- ' + f) : []), '');
  if (p.angebot) L.push('## Expandierte Vorlage (Angebot)', '', `Angebot ${p.angebot.nr}, Vorlage \`${p.angebot.ref}\`, Ort ${p.angebot.hex}`, '', Ablage.zaun(JSON.stringify(p.angebot.vorlage, null, 2), 'json'));
  p.aufrufe.forEach((a, i) => {
    L.push(`## Rohantwort${p.aufrufe.length > 1 ? ' (Versuch ' + (i + 1) + ')' : ''}`, '');
    if (a.antwort) L.push(Ablage.zaun(a.antwort.text, 'json'));
    else L.push(`_Keine Antwort: ${a.fehler || 'Fehler'}_`, '');
  });
  if (e) L.push('## Logbuch-Eintrag', '', Ablage.zaun(JSON.stringify(e, null, 2), 'json'));
  return L.join('\n');
}
function ablegen(ctx) {
  const { ordner, plaene, zaehl, folgen, gesamt, wiederholt, dauer, budget0, budget1, bezeichnung, modus, t0, abbruch, argv } = ctx;
  const zeilen = [];
  for (const p of plaene) {
    Ablage.schreibe(ordner, planDatei(p.nr), planMarkdown(p, ctx));
    const a0 = p.aufrufe[0];
    Ablage.schreibe(ordner, `plan-${nn(p.nr)}.prompt.txt`, a0 && typeof a0.prompt === 'string' ? a0.prompt : '(kein Prompt aufgenommen)\n');
    const e = p.eintrag, titel = p.gelesen && p.gelesen.plan && p.gelesen.plan.titel;
    zeilen.push({ nr: p.nr, datei: planDatei(p.nr), titel: titel || '', ausgang: e ? e.ausgang : 'kein_ergebnis', grund: (e && e.grund) || '', dauer_s: e ? e.dauer_s : null, tokens: e ? e.tokens : 0, geld: e && Number.isFinite(e.geld) ? e.geld : null,
      typen: p.gelesen && p.gelesen.plan && Array.isArray(p.gelesen.plan.beats) ? p.gelesen.plan.beats.map((x) => x && x.typ).join('>') : '', anbieter: e ? e.anbieter : null, modell: e ? e.modell : null, plan_sha1: p.gelesen && p.gelesen.plan ? Ablage.sha1(JSON.stringify(p.gelesen.plan)) : null, fehler: (e && e.fehler) || [] });
  }
  const doppelte = (key) => { const c = {}; for (const z of zeilen) if (z[key]) c[z[key]] = (c[z[key]] || 0) + 1; return Object.values(c).filter((n) => n > 1).reduce((s, n) => s + n - 1, 0); };
  const titelDup = doppelte('titel'), planDup = doppelte('plan_sha1');
  const abgelehnt = Object.values(zaehl.abgelehnt).reduce((s, x) => s + x, 0), ausfall = Object.values(zaehl.ausfall).reduce((s, x) => s + x, 0);
  const geldBekannt = zaehl.geldBekannt > 0 && modus === 'live';
  const zf = {
    aufrufe: gesamt, gueltig: zaehl.gueltig, abgelehnt, ausfall, abgelehnt_je_code: zaehl.abgelehnt, ausfall_je_code: zaehl.ausfall,
    dauer_median_s: Ablage.median(dauer), dauer_p90_s: Ablage.perzentil(dauer, 90), dauer_max_s: dauer.length ? Math.max(...dauer) : null,
    tokens: zaehl.tokens, tokens_je_aufruf: gesamt ? zaehl.tokens / gesamt : null, kosten_usd: geldBekannt ? zaehl.geld : null,
    wiederholungen: wiederholt, wiederholungen_von: Math.max(0, folgen.length - 1), verschiedene_typenfolgen: new Set(folgen).size, lesbare_antworten: folgen.length, doppelte_titel: titelDup, doppelte_plaene: planDup,
    budget: { limit: budget1.limit, vorher_used: budget0.used, nachher_used: budget1.used, zaehler_delta: budget1.used - budget0.used, anteil_am_limit: budget1.limit ? (budget1.used - budget0.used) / budget1.limit : null, zaehlt_nur_claude: true },
  };
  const f = Ablage.fmt, pz = Ablage.prozent;
  const I = [Ablage.frontmatter({ titel: 'Messung Abenteuer-Komposition', werkzeug: 'tools/messe-abenteuer.js', modus, bezeichnung, aufrufe: gesamt, erstellt: new Date().toISOString() }), '# Messung Abenteuer-Komposition', ''];
  I.push(`- Anbieter: ${bezeichnung}`, `- Aufruf: \`node tools/messe-abenteuer.js ${argv.join(' ')}\``, `- Laufzeit: ${f((Date.now() - t0) / 1000, 10)} s${abbruch ? ' · Abbruch: ' + abbruch : ''}`, '');
  I.push('## Zusammenfassung', '');
  I.push(`- Gültigkeit: gültig ${zaehl.gueltig} (${pz(zaehl.gueltig, gesamt)}), abgelehnt ${abgelehnt} (${pz(abgelehnt, gesamt)}), Ausfall ${ausfall} (${pz(ausfall, gesamt)}) von ${gesamt} Aufrufen`);
  I.push(`- Ablehnungen je Code: ${Object.entries(zaehl.abgelehnt).map(([k, v]) => `${k} ${v}`).join(', ') || 'keine'}; Ausfälle je Code: ${Object.entries(zaehl.ausfall).map(([k, v]) => `${k} ${v}`).join(', ') || 'keine'}`);
  I.push(`- Dauer je Aufruf: Median ${f(zf.dauer_median_s, 100)} s, p90 ${f(zf.dauer_p90_s, 100)} s, max ${f(zf.dauer_max_s, 100)} s`);
  I.push(`- Tokens: ${f(zaehl.tokens)} (je Aufruf ${gesamt ? f(zaehl.tokens / gesamt) : '–'}); Zähler gegen CLAUDE_TOKEN_BUDGET: ${f(zf.budget.zaehler_delta)} von ${f(zf.budget.limit)} (${zf.budget.anteil_am_limit != null ? f(zf.budget.anteil_am_limit * 100, 100) + ' %' : '–'}); der Zähler zählt nur Claude-Läufe${modus === 'mock' ? ', der Mock verbraucht nichts' : ''}`);
  I.push(`- Kosten: ${geldBekannt ? f(zaehl.geld, 10000) + ' USD (CLI-Wert total_cost_usd)' : 'nicht gemeldet'}`);
  I.push(`- Wiederholungsrate (gleiche Typenfolge wie die vorige lesbare Antwort): ${wiederholt} von ${zf.wiederholungen_von} (${pz(wiederholt, zf.wiederholungen_von)}); ${zf.verschiedene_typenfolgen} verschiedene Typenfolgen in ${folgen.length} lesbaren Antworten; doppelte Titel ${titelDup}, völlig gleiche Pläne ${planDup}`, '');
  if (modus === 'mock') I.push('> [!info] Mock-Werte prüfen die Kette und das Werkzeug; sie sagen nichts über die Qualität eines echten Modells.', '');
  I.push('## Aufrufe', '', '| Nr | Plan | Titel | Ausgang | Grund | Dauer s | Tokens | Kosten USD | Typenfolge |', '|---|---|---|---|---|---|---|---|---|');
  for (const z of zeilen) I.push(`| ${z.nr} | [${z.datei}](${z.datei}) | ${Ablage.zelle(z.titel)} | ${z.ausgang} | ${Ablage.zelle(z.grund)} | ${f(z.dauer_s, 100)} | ${f(z.tokens)} | ${z.geld != null && modus === 'live' ? f(z.geld, 10000) : '–'} | ${Ablage.zelle(z.typen)} |`);
  I.push('', 'Rohdaten: [messung.json](messung.json). Logbuch des Spiels: `regie/`' + (modus === 'live' ? ', Aufnahmen von Prompt und Rohantwort je Aufruf: `regie/aufnahmen/abenteuer/`.' : '.'), '');
  Ablage.schreibe(ordner, 'index.md', I.join('\n'));
  Ablage.schreibe(ordner, 'messung.json', JSON.stringify({ format: 'messung-abenteuer/1', werkzeug: 'tools/messe-abenteuer.js', aufruf: argv, modus, bezeichnung, erstellt: new Date().toISOString(), abbruch, zusammenfassung: zf, aufrufe: zeilen.map((z) => Object.assign({}, z, { rohantwort: ((plaene.find((p) => p.nr === z.nr) || {}).aufrufe || []).map((a) => (a.antwort ? a.antwort.text : null)) })) }, null, 1));
}

async function main() {
  aufrufPruefen();
  let modus = 'mock', llm = null, N = nArg || 200, bezeichnung = 'Mock (deterministisch, ohne Netz)';
  const alteLive = process.env.LLM_LIVE;
  let ordner = null;
  const neuerOrdner = (m) => { if (ausgabeWurzel && !ordner) { try { ordner = Ablage.laufOrdner(ausgabeWurzel, 'abenteuer-' + m); } catch (e) { console.error(e.message); process.exit(2); } } return ordner; };
  const recordDir = () => (neuerOrdner(modus) ? path.join(ordner, 'regie', 'aufnahmen') : undefined);   // nur live schreibt llm.js Aufnahmen
  if (live || anbieter === 'claude') {
    N = aufrufZahl('claude', nArg);
    const cli = LLM.claudeFinden();
    if (process.env.LLM_LIVE !== '1') { console.log('Messung Claude: nicht gemessen (LLM_LIVE=1 ist nicht gesetzt; echte Aufrufe kosten Geld und laufen nur von Hand).'); return; }
    if (!cli.cmd) { console.log(`Messung Claude: nicht gemessen (Claude-CLI nicht gefunden; versucht: ${cli.versucht.join(', ') || 'nichts'}; CLAUDE_CLI setzen).`); return; }
    modus = 'live';
    const router = Router.routeTransport({ bauplan: { anbieter: 'claude', modell: modell || 'sonnet' } }, { eskalation: null });
    llm = LLM.create({ mode: 'live', transport: router, recordDir: recordDir() });
    bezeichnung = `Claude (${modell || 'sonnet'}), echte Aufrufe, hoechstens 10`;
  } else if (anbieter === 'ollama') {
    N = aufrufZahl('ollama', nArg);
    const g0 = await Ollama.gesund({});
    if (!g0.ok) { console.log(`Messung Ollama: nicht gemessen (Dienst nicht erreichbar: ${g0.url}, ${g0.fehler}; der ssh-Tunnel auf Sleipnir muss stehen, OLLAMA_URL setzen).`); return; }
    process.env.LLM_LIVE = '1';   // lokal und kostenlos: der Schutz gilt den bezahlten Aufrufen
    modus = 'live';
    const router = Router.routeTransport({ bauplan: { anbieter: 'ollama', modell } }, { eskalation: null });
    llm = LLM.create({ mode: 'live', transport: router, recordDir: recordDir() });
    bezeichnung = `Ollama (${modell || Ollama.DEFAULT_MODEL}) auf ${g0.url}, Version ${g0.version || '?'}`;
  } else {
    llm = LLM.create({ mode: 'mock' });
  }

  neuerOrdner(modus);
  const spielEnv = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: modus === 'live' ? 'mock' : 'mock' };
  if (ordner) {
    // --out: Logbuch und Mitschnitt in den Lauf-Ordner (die Fixture wuerde REGIE_DIR sonst auf einen Temp-Ordner setzen); ausdruecklich gesetzte Umgebung gilt
    spielEnv.REGIE_DIR = process.env.REGIE_DIR || path.join(ordner, 'regie');
    for (const k of ['MITSCHNITT', 'MITSCHNITT_DIR']) if (process.env[k] !== undefined) spielEnv[k] = process.env[k];
  }
  const t = F.neuesSpiel({ crew: 1, seed: 7, names: ['Messung'], env: spielEnv });
  const g = t.g;
  for (let i = 0; i < 6; i++) g.step();
  const sl = LS.create(g, { llm, abenteuerWerte: { deckel_je_sitzung: 1e9, cooldown_grenzen: 0, timeout_s: modus === 'live' ? 300 : 120 } });
  g.lageSpielleiter = sl; g.lageSchalter = true;
  const ab = sl.abenteuer;
  const roh = [];
  const aufrufeNr = new Map();   // LIV-01 C: je Aufruf-Nr (input.nr) die Aufnahme von Prompt und Antwort/Fehler (kein Index: ein Fehlaufruf hat keine Antwort)
  const ask0 = llm.ask.bind(llm);
  llm.ask = async (k, i, o) => {
    if (k !== 'abenteuer') return ask0(k, i, o);
    const rec = { nr: i && i.nr, start: new Date().toISOString(), prompt: i && i.prompt, system: i && i.system, wall0: Date.now() };
    aufrufeNr.set(rec.nr, (aufrufeNr.get(rec.nr) || []).concat(rec));
    try { const r = await ask0(k, i, o); rec.wall_s = (Date.now() - rec.wall0) / 1000; rec.antwort = r; roh.push(r.text); return r; }
    catch (e) { rec.wall_s = (Date.now() - rec.wall0) / 1000; rec.fehler = (e && e.code ? e.code + ': ' : '') + String((e && e.message) || e).slice(0, 300); throw e; }
  };
  const budget0 = LLM.budget();
  const plaene = [];   // je Aufruf eine Zeile fuer Ablage und messung.json

  const zaehl = { gueltig: 0, abgelehnt: {}, ausfall: {}, tokens: 0, dauer: [], geld: 0, geldBekannt: 0 };
  const folgen = [];
  const t0 = Date.now();
  let abbruch = null;
  for (let i = 0; i < N; i++) {
    const z = Faden.zustandVon(g); z.abenteuerAngebote.length = 0;
    const r = ab.erzwingen();
    if (!r.gestartet) { abbruch = `Aufruf ${i + 1}: nicht gestartet (${r.grund})`; console.log(abbruch); break; }
    const grenze = Date.now() + (modus === 'live' ? 6 * 60 * 1000 : 5 * 1000);
    while (ab.zustand !== 'idle' && Date.now() < grenze) { g.step(); await frei(); if (modus === 'live') await new Promise((s) => setTimeout(s, 25)); }
    if (ab.zustand !== 'idle') { abbruch = `Aufruf ${i + 1}: haengt (nach ${modus === 'live' ? 6 * 60 : 5} s kein Ergebnis), die Messung bricht ab`; console.log(abbruch); zaehl.ausfall.HAENGT = 1; break; }
    const e = (g.lageRegie ? g.lageRegie.log.entries : []).filter((x) => x.art === 'abenteuer_bauplan' && ['gueltig', 'abgelehnt', 'ausfall'].includes(x.ausgang) && x.plan && x.plan.nr === ab.aufrufe).pop();   // das Logbuch im Speicher haelt nur die letzten 200 Eintraege: ueber die Nummer des Aufrufs suchen
    if (!e) { zaehl.ausfall.KEIN_ERGEBNIS = (zaehl.ausfall.KEIN_ERGEBNIS || 0) + 1; plaene.push({ nr: ab.aufrufe, eintrag: null, aufrufe: aufrufeNr.get(ab.aufrufe) || [], angebot: null }); continue; }
    if (e.ausgang === 'gueltig') zaehl.gueltig++;
    else if (e.ausgang === 'abgelehnt') zaehl.abgelehnt[e.grund] = (zaehl.abgelehnt[e.grund] || 0) + 1;
    else zaehl.ausfall[e.grund] = (zaehl.ausfall[e.grund] || 0) + 1;
    zaehl.tokens += e.tokens || 0;
    if (Number.isFinite(e.dauer_s)) zaehl.dauer.push(e.dauer_s);
    if (Number.isFinite(e.geld)) { zaehl.geld += e.geld; zaehl.geldBekannt++; }
    const aufn = (aufrufeNr.get(ab.aufrufe) || []);
    const letzteAufn = aufn[aufn.length - 1];
    const gelesen = letzteAufn && letzteAufn.antwort ? AP.bauplanAusText(letzteAufn.antwort.text) : null;   // die Antwort DIESES Aufrufs (bei einem Fehlaufruf keine, statt der vorigen)
    const angebot = e.ausgang === 'gueltig' ? ((Faden.zustandVon(g).abenteuerAngebote || []).find((a) => a.ref === (e.plan && e.plan.vorlage)) || null) : null;
    plaene.push({ nr: ab.aufrufe, eintrag: e, aufrufe: aufn, gelesen, angebot });
    if (gelesen && gelesen.plan && Array.isArray(gelesen.plan.beats)) folgen.push(gelesen.plan.beats.map((x) => x && x.typ).join('>'));
  }
  if (alteLive === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = alteLive;

  const abgelehnt = Object.values(zaehl.abgelehnt).reduce((s, x) => s + x, 0), ausfall = Object.values(zaehl.ausfall).reduce((s, x) => s + x, 0);
  const gesamt = zaehl.gueltig + abgelehnt + ausfall;
  const wiederholt = wiederholungen(folgen);
  const sortiert = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${prozent(v, gesamt)})`).join(', ') || 'keine';
  const dauer = zaehl.dauer.slice().sort((a, b) => a - b);
  console.log(`Messung Abenteuer-Komposition: ${bezeichnung}`);
  console.log(`Aufrufe: ${gesamt}`);
  console.log(`Gültigkeit: gültig ${zaehl.gueltig} (${prozent(zaehl.gueltig, gesamt)}), abgelehnt ${abgelehnt} (${prozent(abgelehnt, gesamt)}), Ausfall ${ausfall} (${prozent(ausfall, gesamt)})`);
  console.log(`Ablehnquote je Code (Anteil an allen Aufrufen): ${sortiert(zaehl.abgelehnt)}`);
  if (ausfall) console.log(`Ausfälle je Code: ${sortiert(zaehl.ausfall)}`);
  console.log(`Wiederholungsrate (gleiche Typenfolge wie die vorige lesbare Antwort): ${wiederholt} von ${Math.max(0, folgen.length - 1)} (${prozent(wiederholt, Math.max(0, folgen.length - 1))}); ${new Set(folgen).size} verschiedene Typenfolgen in ${folgen.length} lesbaren Antworten`);
  console.log(`Tokens: ${fmt(zaehl.tokens)} (je Aufruf ${gesamt ? fmt(zaehl.tokens / gesamt) : '–'}); Dauer je Aufruf: ${dauerText(dauer)}; Geld: ${zaehl.geldBekannt ? (Math.round(zaehl.geld * 10000) / 10000).toLocaleString('de-DE', { maximumFractionDigits: 4 }) + ' USD' : 'nicht gemeldet'}; Laufzeit ${fmt((Date.now() - t0) / 1000, 10)} s`);
  if (modus === 'mock') console.log('Hinweis: Mock-Werte pruefen die Kette und das Werkzeug; sie sagen nichts ueber die Qualitaet eines echten Modells (dafuer --live bzw. --anbieter).');
  g.errors && console.log(`Serverfehler im Lauf: ${g.errors}`);
  if (ordner) {
    try {
      ablegen({ ordner, plaene, zaehl, folgen, gesamt, wiederholt, dauer, budget0, budget1: LLM.budget(), bezeichnung, modus, t0, abbruch, argv: args });
      console.log(`Ablage: ${ordner} (index.md, ${plaene.length} Plan-Dateien, messung.json)`);
    } catch (err) { console.error('Ablage fehlgeschlagen: ' + err.message); process.exitCode = 1; }
  }
  sl.dispose();
}
if (require.main === module) main().then(() => process.exit(process.exitCode || 0), (e) => { console.error('Abbruch: ' + (e && e.stack)); process.exit(1); });
module.exports = { wiederholungen, prozent, aufrufZahl, dauerText };
