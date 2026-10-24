'use strict';
// SUND-03 A2: Lage-Spielleiter (server/sim/lage-spielleiter.js, lage-prompt.js, lage-mock.js, Hooks in game.js und kriegslage.js, kind 'lage' in llm.js). Direkt gegen die Game-Klasse, ohne Netz, ohne Claude:
// alle Antworten kommen aus Mock, Script oder Fake-Transporten.
//   Daten und Katalog (aus den Daten abgeleitet, Felder passen zum Kern) · Prompt (statischer Teil vorn und stabil, keine Spielernamen, Größenobergrenze) · Antwort lesen (Zäune, Anhang, Komma) ·
//   llm.js kind 'lage' (Mock, Script, Router, Live nur mit beiden Schaltern) · Schalter (Standard aus, Bestand byte-gleich) · Grenzen (nur die definierten Hooks) · Mindestabstand und Deckel (Abend) ·
//   Ausfall-Matrix (Sim byte-gleich zu „ohne Spielleiter“, nie blockiert) · späte Antworten · veraltete Pläne · Debug-Kommandos · Logbuch und Bericht · Mehrspieler zu dritt (Protokoll unberührt).
//   node tools/test-lage-spielleiter.js [begriff …]   (npm run test:lage-spielleiter)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const LLM = require('../server/mission/llm.js');
const Router = require('../server/mission/transport-router.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Regie = require('../server/sim/regie-befehle.js');
const Ruf = require('../server/sim/ruf.js');
const Absicht = require('../server/sim/absicht.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Prompt = require('../server/sim/lage-prompt.js');
const Mock = require('../server/sim/lage-mock.js');
const Bericht = require('./regie-bericht.js');
const Regielog = require('../server/mission/regielog.js');
const F = require('./regie-fixture.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const gewaehlt = (name) => !FILTER.length || FILTER.some((f) => name.toLowerCase().includes(f));
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const { gleich } = F;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frei = () => new Promise((r) => setImmediate(r));

const DATEN = require('../content/welt/lage-spielleiter-werte.json').werte;
const W = Object.fromEntries(Object.entries(DATEN).map(([k, v]) => [k, v.wert]));
const BW = require('../content/welt/befehle-werte.json').werte;
const RW = require('../content/welt/regie-werte.json').werte;
const KATALOG_DATEI = require('../content/welt/lage-katalog.json').befehle;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const AN = { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' };

const ws = (g) => g.weltsim;
const z = (g) => g.weltsim.zustand;
const tick = (g, k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'test'); };
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
const eintraege = (g, art, ausgang) => logbuch(g).filter((e) => e.art === art && (ausgang === undefined || e.ausgang === ausgang));
const lageEintraege = (g, ausgang) => eintraege(g, 'lage_grobplan', ausgang);
const dichtes = (g) => ({ zustand: z(g), regie: ws(g).regie, tickZahl: ws(g).tickZahl, absicht: ws(g).absicht, ruf: ws(g).ruf });
const gleicheWelt = (a, b) => gleich(dichtes(a), dichtes(b));

// Spiel ohne Schalter (wie der Bestand) und Spiel mit einem eingesetzten Lage-Spielleiter (eigene LLM-Instanz, Script/Mock)
const spiel = (o) => F.neuesSpiel(o);
function mitLage(t, llmOpts, werte, extra) {
  const llm = LLM.create(Object.assign({ mode: 'mock' }, llmOpts || {}));
  llm.asks = []; const ask0 = llm.ask.bind(llm); llm.ask = (k, i, o) => { llm.asks.push(k); return ask0(k, i, o); };   // zählt die Anfragen (auch im Modus mock)
  const sl = LS.create(t.g, Object.assign({ llm, werte: werte || {} }, extra || {}));
  t.g.lageSpielleiter = sl; t.g.lageSchalter = true;   // Einsetzen wie createLageSpielleiter (der Schalter-Zustand ist je Spiel gemerkt)
  return { sl, llm };
}
// Schritte des Spiels mit Mikro-/Makro-Pausen dazwischen: die Antwort kommt asynchron und wird im nächsten update abgeholt
async function pumpen(g, schritte) { for (let i = 0; i < schritte; i++) { g.step(); await frei(); } }
const sitzungSauber = () => LLM.resetBudget();

function frischeOrte(g) { return Object.keys(z(g).hexe).filter((c) => z(g).hexe[c].besitzer); }

// ======================================================================
section('Daten: Takt, Katalog aus den Daten abgeleitet, Felder passen zum Kern', () => {
  ok(Array.isArray(W.grenzen) && W.grenzen.join() === 'szene_ende,andocken,absicht', 'drei Tätigkeitsgrenzen als Daten');
  ok(W.deckel_je_sitzung >= 4 && W.deckel_je_sitzung <= 6, `Deckel ${W.deckel_je_sitzung} im Ziel 4 bis 6 Aufrufe je Abend`);
  ok(Number.isInteger(W.min_abstand_ticks) && W.min_abstand_ticks >= 1 && W.timeout_s > 0 && W.min_budget > 0 && W.plan_alter_max_ticks >= 1 && W.letzte_plaene >= 1, 'Mindestabstand, Timeout, Budget, Alter, Chronik: sinnvolle Zahlen');
  const typen = Object.keys(Kern.BEFEHLE.FELDER).sort();
  ok(gleich(Object.keys(KATALOG_DATEI).sort(), typen), 'der Katalog beschreibt genau die Befehlstypen des Kerns (' + typen.length + ')');
  for (const typ of typen) {
    const soll = Kern.BEFEHLE.FELDER[typ].filter((f) => f !== 'typ').sort();
    ok(gleich(Object.keys(KATALOG_DATEI[typ].felder).sort(), soll), `${typ}: Feldliste des Katalogs = FELDER des Kerns (${soll.join(', ')})`);
  }
  const text = Prompt.katalogText();
  ok(!/\{[wr]\./.test(text), 'kein Platzhalter bleibt im Katalogtext stehen');
  ok(typen.every((t) => text.includes('- ' + t + ' {')), 'jeder Befehl steht im Katalogtext');
  ok(typen.every((t) => Kern.BEFEHLE.FELDER[t].filter((f) => f !== 'typ').every((f) => text.split('\n').find((l) => l.startsWith('- ' + t + ' {')).includes(' ' + f + ': '))), 'jedes Feld jedes Befehls steht im Katalogtext (Name und Form)');
  ok(Prompt.statischerTeil().hash === Prompt.statischerTeil().hash, 'Hash des statischen Teils: zwei Aufrufe gleich');
  ok(typen.every((t) => text.includes(`Abkühlung: ${RW.abkuehlung.wert[t] || 0} Ticks`)), 'Abkühlzeiten aus regie-werte.json');
  ok(text.includes(`Reichweite ${BW.angreifen.wert.reichweite} Sprünge, höchstens ${BW.angreifen.wert.flotten_max} Flotten`) && text.includes(`Dauer ${BW.dauer.wert.embargo.min} bis ${BW.dauer.wert.embargo.max} Ticks`) && text.includes(`Höchstens ${RW.plan.wert.befehle_max} Befehle je Plan`), 'Grenzen aus befehle-werte.json und regie-werte.json');
  ok(text.includes('Embargo nur gegen den Sieger') && text.includes('Vorwarnung'), 'Regeln Sieger und Vorwarnung stehen im Katalog');
  const sys = fs.readFileSync(Prompt.SYSTEM_DATEI, 'utf8');
  ok(/nur Befehle des Katalogs/i.test(sys) && /Vorwarnung/.test(sys) && /Hauptwelten/.test(sys) && /Scheinwahl/.test(sys) && /lage\.sieger/.test(sys) && /ausschließlich mit einem JSON/.test(sys), 'Systemprompt: nur Katalog, keine Scheinwahl, Vorwarnung, Hauptwelt, Sieger, nur JSON');
  ok(!/Ouzo|Mireille|Tzvi/.test(sys), 'Systemprompt ohne Namen');
});

section('Antwort lesen: Zäune, Anhang, Komma, Müll', () => {
  const P = { befehle: [{ typ: 'regler', fraktion: 'ger', aggr: 0.5, dauer: 8 }], begruendung: 'x' };
  const js = JSON.stringify(P);
  ok(gleich(Prompt.planAusText(js).plan, P), 'reines JSON');
  ok(gleich(Prompt.planAusText('```json\n' + js + '\n```').plan, P), 'Codeblock-Zaun mit json');
  ok(gleich(Prompt.planAusText('Hier ist der Plan:\n```\n' + js + '\n```\nViel Erfolg!').plan, P), 'Text um den Zaun');
  ok(gleich(Prompt.planAusText('Plan: ' + js + ' Ende').plan, P), 'Text davor und danach ohne Zaun');
  ok(gleich(Prompt.planAusText('Zuerst {ein Hinweis} dazu:\n```json\n' + js + '\n```').plan, P), 'Klammern im Text vor dem Zaun: der Inhalt des Zauns gilt');
  ok(gleich(Prompt.planAusText('{"befehle": [], "begruendung": "ein } in Text",}').plan, { befehle: [], begruendung: 'ein } in Text' }), 'Komma vor der schließenden Klammer, Klammer im Text-String');
  ok(Prompt.planAusText('{"befehle": [{"typ": "x"').fehler && Prompt.planAusText('kein json').fehler && Prompt.planAusText('').fehler && Prompt.planAusText(null).fehler && Prompt.planAusText('[1,2]').fehler, 'abgeschnitten, Prosa, leer, null, Liste: Fehler statt Plan');
  ok(Prompt.planAusText('{"a": nope}').fehler === 'JSON nicht lesbar', 'kaputtes JSON: Fehler');
});

section('llm.js: kind lage (Mock, Script, Replay, Live, Router)', async () => {
  ok(LLM.KINDS.includes('lage') && LLM.KINDS.includes('grobplan'), 'KINDS additiv: lage neben grobplan, szene, text');
  ok(fs.existsSync(LLM.systemPromptFile('lage')) && /lage\.system\.md$/.test(LLM.systemPromptFile('lage')), 'Systemprompt lage.system.md wird gefunden');
  const t = spiel(); tick(t.g, 3);
  const bau = Prompt.baue(t.g, { art: 'andocken', nr: 1, letzte: [], werte: W });
  const input = { system: Prompt.SYSTEM_DATEI, prompt: bau.prompt };
  const m = LLM.create({ mode: 'mock' });
  const r = await m.ask('lage', input);
  const plan = JSON.parse(r.text);
  ok(r.source === 'mock' && r.tokens === 0 && Array.isArray(plan.befehle !== undefined ? plan.befehle : []) && typeof plan.begruendung === 'string', 'mock liefert einen Plan als JSON');
  ok((await m.ask('lage', input)).text === r.text, 'mock ist deterministisch (gleiche Eingabe, gleiche Antwort)');
  const sc = LLM.create({ mode: 'script', script: { lage: [{ json: { befehle: [] } }, { error: 'timeout' }, { text: 'x', tokens: 77 }] } });
  const a1 = await sc.ask('lage', input);
  let e2 = null; try { await sc.ask('lage', input); } catch (e) { e2 = e; }
  const a3 = await sc.ask('lage', input);
  ok(a1.text === '{"befehle":[]}' && e2 && e2.code === 'ETIMEDOUT' && a3.tokens === 77, 'script: Antwort, Fehler, Tokens nach Plan');
  const sc2 = LLM.create({ mode: 'script', script: { lage: [] } });
  ok(JSON.parse((await sc2.ask('lage', input)).text).begruendung.startsWith('Mock-Regisseur'), 'script ohne Eintrag: Mock-Regisseur');
  let eOff = null; try { await LLM.create({ mode: 'off' }).ask('lage', input); } catch (e) { eOff = e; }
  ok(eOff && eOff.code === 'OFF', 'mode off wirft OFF');
  let eRep = null; try { await LLM.create({ mode: 'replay', fixturesDir: path.join(F.TMP, 'leer') }).ask('lage', input); } catch (e) { eRep = e; }
  ok(eRep && /Keine Aufzeichnung/.test(eRep.message), 'replay ohne Aufzeichnung: Fehler, nie ein Live-Fallback');
  const alt = process.env.LLM_LIVE; delete process.env.LLM_LIVE;
  let eLive = null; try { await LLM.create({ mode: 'live' }).ask('lage', input); } catch (e) { eLive = e; }
  if (alt !== undefined) process.env.LLM_LIVE = alt;
  ok(eLive && eLive.code === 'REFUSED', 'live ohne LLM_LIVE=1 wird verweigert');
  ok(LS.modusAusEnv({ SPIELLEITER_LLM: 'live' }) === 'off' && LS.modusAusEnv({ SPIELLEITER_LLM: 'live', LLM_LIVE: '1' }) === 'live' && LS.modusAusEnv({ SPIELLEITER_LLM: 'mock' }) === 'mock' && LS.modusAusEnv({}) === 'off', 'Modus aus der Umgebung: live nur mit beiden Schaltern');
  // Router: lage geht an Claude, Ollama wird abgewiesen
  const claude = { name: 'cli', calls: [], async call(txt, o) { this.calls.push(o); return { text: '{}', usage: { input: 5, output: 1 }, sec: 0.1 }; } };
  const ollama = { name: 'ollama', calls: [], async call(txt, o) { this.calls.push(o); return { text: '{}', usage: { input: 5, output: 1 }, sec: 0.1 }; } };
  const R = Router.routeTransport({}, { transports: { claude, ollama } });
  ok(R.anbieterFuer('lage') === 'claude' && R.eskalationFuer('lage') === null, 'Router: lage → Claude, keine Eskalation');
  const rr = await R.call('p', { kind: 'lage', model: 'sonnet', system: 's' });
  ok(rr.anbieter === 'claude' && claude.calls.length === 1 && claude.calls[0].kind === 'lage' && ollama.calls.length === 0, 'Router: der Aufruf geht an Claude');
  let eR = null; try { Router.routeTransport({ lage: { anbieter: 'ollama' } }, { transports: { claude, ollama } }); } catch (e) { eR = e; }
  ok(eR && /bleibt bei Claude/.test(eR.message), 'Router: lage bei Ollama wird abgewiesen');
  const re = Router.routerAusEnv({ LLM_ANBIETER_LAGE: 'ollama' }, { transports: { claude, ollama } });
  ok(re.anbieterFuer('lage') === 'claude' && re.warnungen.some((w) => /LLM_ANBIETER_LAGE/.test(w)), 'routerAusEnv: LLM_ANBIETER_LAGE=ollama wird ignoriert und gemeldet');
});

section('Prompt: statischer Teil vorn und stabil, keine Spielernamen, Obergrenze', () => {
  const t = spiel({ crew: 3, names: NAMEN });
  const g = t.g;
  tick(g, 20);
  g.weltsim.chronik = [{ t: 18, art: 'plan', ref: 'p1', kurz: 'Mireille_Kas hat den Posten gegründet' }, { t: 19, art: 'plan', ref: 'p2', kurz: 'Ouzo_Brandt greift Carrara an, Tzvi_Lund hilft' }, { t: 20, art: 'plan', ref: 'p3', kurz: 'Tzvi_Lundx kehrt heim' }];   // SUND-03 D: roh in welt.sim.chronik, der Ausschnitt säubert
  const letzte = [{ nr: 1, tick: 3, grenze: 'andocken', befehle: ['fokus'], begruendung: 'Tzvi_Lund sucht Streit' }];
  const a = Prompt.baue(g, { art: 'szene_ende', nr: 2, letzte, werte: W });
  ok(!a.fehler && a.prompt.length === a.zeichen, 'Prompt gebaut');
  const klein = a.prompt.toLowerCase();
  ok(!NAMEN.some((x) => klein.includes(x.toLowerCase())) && !/mireille|tzvi_lund/.test(klein), 'keine Spielernamen im Prompt (Chronik, Chronik der Pläne, auch ein längeres Wort mit dem Namen davor)');
  ok(a.prompt.includes('Crew') && /"anzahl":3/.test(a.prompt), 'stattdessen nur „Crew“ und die Anzahl 3');
  ok(a.zeichen <= W.prompt_max_zeichen, `Prompt ${a.zeichen} Zeichen ≤ Obergrenze ${W.prompt_max_zeichen}`);
  ok(a.prompt.startsWith('<katalog>\n'), 'der Katalog (statisch) steht ganz vorn');
  const ende = a.prompt.indexOf('</katalog>') + '</katalog>'.length;
  ok(a.prompt.indexOf('<ausschnitt>') > ende && a.prompt.indexOf('<letzte_plaene>') > a.prompt.indexOf('<ausschnitt>') && a.prompt.indexOf('<grenze>') > a.prompt.indexOf('<letzte_plaene>'), 'danach Ausschnitt, letzte Pläne, Grenze (variabel)');
  tick(g, 60);
  const b = Prompt.baue(g, { art: 'andocken', nr: 3, letzte: [], werte: W });
  ok(a.prompt.slice(0, ende) === b.prompt.slice(0, ende) && a.prompt !== b.prompt, 'der statische Teil ist über zwei Aufrufe in anderem Zustand gleich, der variable nicht');
  ok(a.katalogHash === b.katalogHash && Prompt.statischerTeil().hash === a.katalogHash && /^[0-9a-f]{40}$/.test(a.katalogHash), 'Hash des statischen Teils (System + Katalog) stabil');
  // Stress: Ausschnitt nahe der Obergrenze, der Prompt bleibt darunter
  z(g).absichten = { rom: { aggr: 1, p_act: 1, max_active: 5 }, ger: { aggr: 1, p_act: 1, max_active: 5 } };
  let max = 0, alle = true;
  for (let i = 0; i < 80; i++) { tick(g); const p = Prompt.baue(g, { art: 'x', nr: 1, letzte: Array.from({ length: W.letzte_plaene }, () => ({ nr: 1, tick: 1, grenze: 'andocken', befehle: ['fokus ger 0105', 'regler ger', 'nachschub rom'], angenommen: 3, abgelehnt: 1, begruendung: 'x'.repeat(120) })), werte: W }); if (p.fehler) { alle = false; break; } max = Math.max(max, p.zeichen); }
  ok(alle && max <= W.prompt_max_zeichen, `80 Zustände im Stress: größter Prompt ${max} Zeichen ≤ ${W.prompt_max_zeichen}`);
  const eng = Prompt.baue(g, { art: 'x', nr: 1, letzte: [], werte: Object.assign({}, W, { prompt_max_zeichen: 5000 }) });
  ok(eng.fehler && /zu groß/.test(eng.fehler), 'zu wenig Platz für den Ausschnitt: Fehler statt eines Prompts ohne Lage');
  ok(Prompt.namenFiltern('Ouzo_Brandt und OUZO_BRANDT', g).split('Crew').length === 3 && Prompt.namenFiltern('Namenlos', g) === 'Namenlos', 'namenFiltern: Name (auch groß geschrieben) → Crew, sonst unverändert');
});

section('Schalter: Standard aus, der Bestand läuft ohne Env byte-gleich', async () => {
  ok(!LS.schalterAn({}) && !LS.schalterAn({ SPIELLEITER_LLM: 'mock' }) && !LS.schalterAn({ LAGE_SPIELLEITER: '1' }) && !LS.schalterAn({ LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'off' }) && LS.schalterAn({ LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }) && LS.schalterAn({ LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'live' }) && !LS.schalterAn({ LAGE_SPIELLEITER: '0', SPIELLEITER_LLM: 'mock' }), 'LAGE_SPIELLEITER=1 UND SPIELLEITER_LLM ≠ off');
  const a = spiel(), b = spiel({ env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'off' } }), c = spiel({ env: { SPIELLEITER_LLM: 'mock' } });
  for (const t of [a, b, c]) { for (let i = 0; i < 60; i++) t.g.step(); tick(t.g, 25); t.g.lageGrenze('andocken'); t.g.missionEvent('docked', { loc: 'x' }); await pumpen(t.g, 20); }
  ok(!a.g.lageSpielleiter && !b.g.lageSpielleiter && !c.g.lageSpielleiter, 'ohne Schalter (auch nur halb gesetzt) entsteht kein Lage-Spielleiter');
  ok(gleicheWelt(a.g, b.g) && gleicheWelt(a.g, c.g), 'Sim nach 25 Ticks und Grenzen byte-gleich zu „ohne“');
  ok(eintraege(a.g, 'lage_grobplan').length === 0 && eintraege(b.g, 'lage_grobplan').length === 0, 'kein Lage-Eintrag im Logbuch');
  const d = spiel({ env: AN });
  for (let i = 0; i < 5; i++) d.g.step();
  ok(d.g.lageSpielleiter && d.g.lageSpielleiter.mode === 'mock', 'mit beiden Schaltern entsteht er (Modus Freie Fahrt Sund, Mock)');
  ok(d.g.spielleiter === undefined || d.g.spielleiter === null, 'der Spielleiter der Kampagne bleibt in der Freien Fahrt gesperrt');
  ok(d.g.errors === 0 && a.g.errors === 0, 'keine Serverfehler');
});

section('Grenzen: nur die definierten Hooks lösen aus', async () => {
  const t = spiel({ env: AN });
  const g = t.g;
  for (let i = 0; i < 5; i++) g.step();
  const sl = g.lageSpielleiter;
  const ruft = [];
  const orig = sl.beiGrenze.bind(sl);
  sl.beiGrenze = (art) => { ruft.push(art); return orig(art); };
  // 1. Schritte und Ticks ohne Grenze: nichts
  for (let i = 0; i < 40; i++) g.step();
  tick(g, 5);
  ok(ruft.length === 0 && sl.aufrufe === 0, 'Schritte und Sprünge allein sind keine Grenze');
  // 2. Szenenende (wo szene) löst aus, Posten und Notruf nicht
  Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'posten' });
  Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'notruf' });
  ok(ruft.length === 0, 'Ende einer Posten-Operation und eines Notrufs: keine Grenze');
  Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'szene' });
  ok(ruft.join() === 'szene_ende', 'Ende einer Sim-Szene: Grenze szene_ende');
  ruft.length = 0;
  // 3. Andocken
  g.missionEvent('docked', { loc: 'hafen' });
  ok(ruft.join() === 'andocken', 'Andocken (Ereignis docked): Grenze andocken');
  g.missionEvent('undocked', {});
  ok(ruft.length === 1, 'Ablegen ist keine Grenze');
  ruft.length = 0;
  // 4. Strategische Option: Wahl und Ablehnung über das echte Kommando (Konsole shop, ab Tribun)
  const TRIBUN = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === 'tribun').ab;
  Ruf.debug(g, ['rom', String(TRIBUN)]);
  const p = g.players[0]; p.console = 'shop';
  Absicht.debug(g, ['angebot']);
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'absicht.waehlen', id: 'unbekannt_x' });
  ok(ruft.length === 0, 'eine abgelehnte Wahl (unbekannte Id) ist keine Grenze');
  const id = ws(g).absicht.angebot.ids[0];
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'absicht.waehlen', id });
  ok(ruft.join() === 'absicht', 'Wahl einer Strategischen Option: Grenze absicht');
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'absicht.waehlen', id });
  ok(ruft.length === 1, 'zweite Wahl („schon gewählt“) ist keine Grenze');
  Absicht.debug(g, ['ende']); Absicht.debug(g, ['angebot']);
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'absicht.ablehnen' });
  ok(ruft.join() === 'absicht,absicht', 'Ablehnung des Angebots: Grenze absicht');
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'absicht.ablehnen' });
  ok(ruft.length === 2, 'Ablehnung ohne Angebot ist keine Grenze');
  // 5. Unbekannte Grenze und Grenzen, die in den Daten fehlen
  ok(orig('quatsch').grund === 'keine_grenze' && orig('debug').grund === 'keine_grenze', 'eine Art, die nicht in den Daten steht, bleibt ohne Wirkung');
  const t2 = spiel(); const { sl: s2 } = mitLage(t2, {}, { grenzen: ['andocken'] });
  ok(s2.beiGrenze('szene_ende').grund === 'keine_grenze' && s2.beiGrenze('andocken').gestartet, 'Grenzen als Daten: nur andocken eingeschaltet');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Takt: Mindestabstand, Deckel, ein Job zugleich, Abend', async () => {
  sitzungSauber();
  // Mindestabstand: jede Grenze in jedem Tick: nur alle min_abstand_ticks ein Plan
  const t = spiel(); const { sl } = mitLage(t, {});
  const g = t.g;
  const starts = [];
  for (let k = 0; k < 2 * W.min_abstand_ticks + 2; k++) {
    const r = sl.beiGrenze('andocken'); if (r.gestartet) starts.push(ws(g).tickZahl);
    await pumpen(g, 3); tick(g);
  }
  ok(starts.length === 3 && starts[1] - starts[0] === W.min_abstand_ticks && starts[2] - starts[1] === W.min_abstand_ticks, `Mindestabstand ${W.min_abstand_ticks} Ticks: Starts bei ${starts.join(', ')}`);
  ok(sl.zaehler.uebersprungen.abstand > 0, 'übersprungene Grenzen werden gezählt (abstand)');
  ok(lageEintraege(g, 'uebersprungen').length > 0 && lageEintraege(g, 'uebersprungen')[0].fehler.length === 0, 'und im Logbuch vermerkt');
  // Stillstand der Sim-Zeit: keine Grenze löst aus, solange kein Sprung kam
  const s0 = sl.aufrufe; sl.letzterStartTick = ws(g).tickZahl;
  for (let i = 0; i < 5; i++) sl.beiGrenze('andocken');
  ok(sl.aufrufe === s0, 'ohne Sprung (gleicher Tick) kein zweiter Plan');
  // ein Job zugleich
  const t2 = spiel(); const { sl: s2, llm: l2 } = mitLage(t2, { mode: 'script', script: { lage: [{ hold: true }] } });
  s2.beiGrenze('andocken'); await pumpen(t2.g, 3);
  ok(s2.zustand === 'laeuft' && l2.pending() === 1, 'Anfrage in der Luft');
  tick(t2.g, W.min_abstand_ticks + 1);
  ok(s2.beiGrenze('andocken').grund === 'beschaeftigt' && l2.asks.length === 1, 'solange sie läuft, startet keine zweite (beschaeftigt)');
  s2.dispose();
  // Abend: Bot-Lauf mit allen drei Grenzen, Mock-Regisseur
  const A = spiel(); const { sl: sa, llm: la } = mitLage(A, {});
  const ga = A.g;
  const grenzenLauf = ['andocken', 'szene_ende', 'absicht'];
  let auswahl = 0, angenommen = 0;
  const TAKT = 3, TICKS = 150;
  for (let k = 1; k <= TICKS; k++) {
    tick(ga);
    if (k % TAKT === 0) {
      const art = grenzenLauf[auswahl++ % 3];
      if (art === 'andocken') ga.missionEvent('docked', { loc: 'x' });
      else if (art === 'szene_ende') Kriegslage.szeneAbschliessen(ga, { wirkungen: [], wo: 'szene' });
      else ga.lageGrenze('absicht');
    }
    await pumpen(ga, 2);
  }
  await pumpen(ga, 5);
  const angew = lageEintraege(ga, 'angewandt');
  angenommen = eintraege(ga, 'lage_befehl', 'vorgemerkt').length;
  console.log(`  Messung Abend (Mock): ${TICKS} Ticks, ${Math.floor(TICKS / TAKT)} Grenzen, Aufrufe ${sa.aufrufe} (Deckel ${W.deckel_je_sitzung}), angewandt ${angew.length}, Befehle vorgemerkt ${angenommen}, übersprungen ${JSON.stringify(sa.zaehler.uebersprungen)}, Fehler ${sa.zaehler.fehler}`);
  ok(sa.aufrufe <= W.deckel_je_sitzung && sa.aufrufe >= 4 && sa.aufrufe <= 6, `Aufrufe je Abend ${sa.aufrufe}: höchstens der Deckel, im Ziel 4 bis 6`);
  ok(angew.length === sa.aufrufe && sa.zaehler.fehler === 0, 'jeder Plan des Mock-Regisseurs ist gültig und wird angewandt, kein Fehler');
  ok(sa.zaehler.uebersprungen.deckel > 0, 'nach dem Deckel werden Grenzen übersprungen (deckel)');
  ok(la.asks.length === sa.aufrufe, 'die LLM-Schnittstelle sah genau so viele Anfragen wie gezählt');
  ok(sa.aufrufe === lageEintraege(ga).filter((e) => e.ausgang === 'angewandt').length, 'Logbuch: ein Eintrag je Aufruf');
  const typen = new Set(); for (const e of eintraege(ga, 'lage_befehl', 'vorgemerkt')) typen.add(e.key);
  ok(typen.size >= 2, `die Pläne wechseln die Befehle (${[...typen].join(', ')})`);
  ok(sa.letzte_plaene.length === Math.min(W.letzte_plaene, sa.aufrufe) && sa.letzte_plaene.at(-1).nr === sa.aufrufe, `letzte_plaene: Ringliste mit ${W.letzte_plaene} Einträgen`);
  ok(ga.errors === 0, 'keine Serverfehler');
  // der Mock sieht die Chronik: der nächste Prompt trägt die letzten Pläne
  const prompt = la.asks.length && Prompt.baue(ga, { art: 'x', nr: 9, letzte: sa.letzte_plaene, werte: W }).prompt;
  ok(/<letzte_plaene>\n\[\{/.test(prompt) && prompt.includes('Mock-Regisseur'), 'die letzten Pläne gehen kurz in den nächsten Prompt');
});

section('Mock-Regisseur: Pläne variieren und sind gültig', async () => {
  const t = spiel(); const g = t.g;
  for (const [sieg] of [['rom'], ['ger'], ['offen']]) {
    if (sieg !== 'offen') { for (let i = 0; i < 2; i++) ws(g).ereignisse.push({ n: ws(g).tickZahl, typ: 'hafen_gefallen', fraktion: sieg, ort: '0105', ortName: 'Carrara', alt: sieg === 'rom' ? 'ger' : 'rom', neu: sieg }); }
    else ws(g).ereignisse.length = 0;
    const typen = [];
    for (let nr = 1; nr <= Mock.VARIANTEN.length; nr++) {
      tick(g, 12);
      const bau = Prompt.baue(g, { art: 'andocken', nr, letzte: [], werte: W });
      const plan = Mock.planVon({ prompt: bau.prompt });
      const res = Regie.planPruefen(g, plan);
      typen.push([...(plan.befehle || []).map((b) => b.typ), plan.fokus ? 'fokus' : null].filter(Boolean)[0]);
      ok(res.ok && res.abgelehnt.length === 0 && (res.angenommen.length >= 1), `Sieger ${sieg}, Plan ${nr} (${typen[nr - 1]}) ist gültig, kein Befehl abgelehnt${res.abgelehnt.length ? ': ' + res.abgelehnt.map((a) => a.grund).join('; ') : ''}`);
    }
    ok(new Set(typen).size >= 3, `Sieger ${sieg}: wechselnde Befehle (${typen.join(', ')})`);
  }
});

section('Mock-Regisseur: ohne Sieger kein Embargo', () => {
  const prompt = (nr, sieger) => '<ausschnitt>\n' + JSON.stringify({ crew: { anzahl: 1, hex: '0105' }, lage: { sieger }, orte: [], flotten: {} }) + '\n</ausschnitt>\n\n<grenze>\n' + JSON.stringify({ art: 'andocken', nr }) + '\n</grenze>';
  const p4 = Mock.planVon({ prompt: prompt(4, 'offen') });
  ok(Mock.VARIANTEN[3] === 'embargo' && !(p4.befehle || []).some((b) => b.typ === 'embargo') && p4.fokus && p4.fokus.hex === '0105', 'Lage offen: Plan 4 ist kein Embargo (Ersatz: Fokus an der Crew)');
  const p4r = Mock.planVon({ prompt: prompt(4, 'rom') });
  ok(p4r.befehle.length === 1 && p4r.befehle[0].typ === 'embargo' && p4r.befehle[0].gegen === 'rom', 'Sieger rom: Plan 4 ist ein Embargo gegen Rom (Vorwarnung macht die Regie-Schicht)');
  ok(Mock.planVon({ prompt: 'kaputt' }).begruendung.startsWith('Mock-Regisseur') && gleich(Mock.planVon({ prompt: prompt(1, 'offen') }), Mock.planVon({ prompt: prompt(1, 'offen') })), 'ohne lesbaren Ausschnitt trotzdem ein Plan; deterministisch');
});

section('Ausfall-Matrix: Sim byte-gleich zu „ohne Spielleiter“, nie blockiert', async () => {
  const FAELLE = [
    ['Claude tot (CLI fehlt)', { mode: 'script', script: { lage: [{ error: 'enoent' }] } }, {}, 'ENOENT'],
    ['Claude tot (Exit 1)', { mode: 'script', script: { lage: [{ error: 'exit' }] } }, {}, 'EXIT'],
    ['Ratenlimit 429', { mode: 'script', script: { lage: [{ error: '429' }] } }, {}, 'RATE_LIMIT'],
    ['Timeout des Transports', { mode: 'script', script: { lage: [{ error: 'timeout' }] } }, {}, 'ETIMEDOUT'],
    ['Timeout in Spielzeit (Antwort bleibt aus)', { mode: 'script', script: { lage: [{ hold: true }] } }, { timeout_s: 1 }, 'ETIMEDOUT'],
    ['ungültiges JSON', { mode: 'script', script: { lage: [{ text: 'Ich denke, wir sollten Rom stärken.' }] } }, {}, 'unbrauchbar'],
    ['abgeschnittenes JSON', { mode: 'script', script: { lage: [{ text: '{"befehle": [{"typ": "fokus"' }] } }, {}, 'unbrauchbar'],
    ['ungültiger Plan (Schema)', { mode: 'script', script: { lage: [{ json: { befehle: 'viele' } }] } }, {}, 'Plan ungültig'],
    ['ungültiger Plan (Fremdfeld)', { mode: 'script', script: { lage: [{ json: { befehle: [], sieger: 'rom' } }] } }, {}, 'Plan ungültig'],
    ['Plan voller ungültiger Befehle', { mode: 'script', script: { lage: [{ json: { befehle: [{ typ: 'angreifen', fraktion: 'ger', ziel: '0105' }, { typ: 'zaubern' }, { typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['M'], dauer: 6 }], begruendung: 'x' } }] } }, {}, null],
  ];
  for (const [name, llmOpts, werte, code] of FAELLE) {
    sitzungSauber();
    const haelt = !!llmOpts.script.lage[0].hold;
    const ohne = spiel(), mit = spiel();
    const { sl, llm } = mitLage(mit, llmOpts, werte);
    for (let k = 0; k < 30; k++) {
      tick(ohne.g); tick(mit.g);
      if (k === 2) sl.beiGrenze('andocken');
      await pumpen(mit.g, 3); await pumpen(ohne.g, 3);
    }
    if (haelt) { await pumpen(mit.g, 80); }
    const f = lageEintraege(mit.g, 'fehler'), a = lageEintraege(mit.g, 'angewandt');
    if (code) {
      ok(f.length === 1 && a.length === 0 && (f[0].fehler[0] || '').includes(code), `${name}: Fehler im Logbuch (${code}), kein Plan`);
      ok(gleicheWelt(ohne.g, mit.g), `${name}: Sim byte-gleich zu „ohne Spielleiter“`);
      ok(eintraege(mit.g, 'lage_befehl', 'rueckfall').length >= 1 && ws(mit.g).regie.vorgemerkt.length === 0, `${name}: Rückfall im Logbuch, nichts wartet`);
    } else {
      ok(a.length === 1 && f.length === 0 && eintraege(mit.g, 'lage_befehl', 'abgelehnt').length === 3 && ws(mit.g).regie.vorgemerkt.length === 0 && gleicheWelt(ohne.g, mit.g), `${name}: lesbarer Plan, jeder Befehl mit Grund abgelehnt, nichts vorgemerkt, Sim byte-gleich zu „ohne“`);
    }
    ok(sl.zustand === 'idle' && mit.g.errors === 0, `${name}: Zustand idle, keine Serverfehler`);
    if (llm.pending()) llm.release();
    await pumpen(mit.g, 5);
    ok(ws(mit.g).regie.vorgemerkt.length === 0 || !code, `${name}: eine spätere Antwort ändert nichts`);
  }
  // Plan mit ungültigen UND gültigen Befehlen: gültige laufen, ungültige werden abgelehnt (kein Rückfall)
  {
    sitzungSauber();
    const mit = spiel(); const { sl } = mitLage(mit, { mode: 'script', script: { lage: [{ json: { befehle: [{ typ: 'zaubern' }], fokus: { hex: '0105', radius: 2 }, begruendung: 'x' } }] } });
    sl.beiGrenze('andocken'); await pumpen(mit.g, 4);
    ok(lageEintraege(mit.g, 'angewandt').length === 1 && eintraege(mit.g, 'lage_befehl', 'abgelehnt').length === 1 && ws(mit.g).regie.vorgemerkt.length >= 1 && eintraege(mit.g, 'lage_befehl', 'rueckfall').length === 0, 'teilweise ungültiger Plan: Gültiges vorgemerkt, Ungültiges abgelehnt, kein Rückfall');
  }
  // Budget leer
  {
    sitzungSauber(); LLM.setBudgetLimit(W.min_budget - 1);
    const ohne = spiel(), mit = spiel(); const { sl, llm } = mitLage(mit, {});
    for (let k = 0; k < 20; k++) { tick(ohne.g); tick(mit.g); if (k === 2) ok(sl.beiGrenze('andocken').grund === 'budget', 'Budget leer: keine Anfrage'); await pumpen(mit.g, 2); }
    ok(llm.asks.length === 0 && lageEintraege(mit.g, 'fehler').some((e) => e.fehler[0] === 'BUDGET') && gleicheWelt(ohne.g, mit.g), 'Budget leer: Eintrag BUDGET, Sim byte-gleich zu „ohne“');
    sitzungSauber();
  }
  // Schalter aus (Modus off)
  {
    const ohne = spiel(), mit = spiel(); const { sl, llm } = mitLage(mit, { mode: 'off' });
    for (let k = 0; k < 20; k++) { tick(ohne.g); tick(mit.g); if (k === 2 || k === 12) sl.beiGrenze('andocken'); await pumpen(mit.g, 2); }
    ok(sl.aufrufe === 0 && llm.asks.length === 0 && gleicheWelt(ohne.g, mit.g) && eintraege(mit.g, 'lage_befehl', 'rueckfall').length === 1, 'Schalter aus: keine Anfrage, Sim byte-gleich, genau ein Rückfall-Eintrag (nicht je Grenze)');
  }
  // dispose mit Anfrage in der Luft
  {
    sitzungSauber();
    const ohne = spiel(), mit = spiel(); const { sl, llm } = mitLage(mit, { mode: 'script', script: { lage: [{ hold: true }] } });
    for (let k = 0; k < 10; k++) { tick(ohne.g); tick(mit.g); if (k === 1) sl.beiGrenze('andocken'); await pumpen(mit.g, 2); }
    ok(sl.zustand === 'laeuft' && llm.pending() === 1, 'dispose-Fall: Anfrage in der Luft');
    sl.dispose();
    ok(sl.zustand === 'idle' && sl.job === null && eintraege(mit.g, 'lage_befehl', 'rueckfall').length === 1, 'dispose: Job weg, Rückfall im Logbuch');
    llm.release(); await pumpen(mit.g, 5); tick(ohne.g, 3); tick(mit.g, 3);
    ok(lageEintraege(mit.g, 'angewandt').length === 0 && sl.beiGrenze('andocken').grund === 'dispose' && gleicheWelt(ohne.g, mit.g), 'späte Antwort nach dispose verworfen, Sim byte-gleich, danach keine Grenze mehr');
    sl.update(0.03); sl.dispose();
    ok(mit.g.errors === 0, 'update und zweites dispose nach dispose werfen nicht');
  }
  // Raumende über das Spiel selbst: reset() ruft dispose
  {
    const t = spiel({ env: AN }); for (let i = 0; i < 3; i++) t.g.step();
    const sl = t.g.lageSpielleiter; sl.llm = LLM.create({ mode: 'script', script: { lage: [{ hold: true }] } });
    tick(t.g, 1); sl.beiGrenze('andocken'); await pumpen(t.g, 3);
    t.g.reset();
    ok(sl.disposed && t.g.lageSpielleiter === null && t.g.errors === 0, 'Game.reset() beendet den Lage-Spielleiter (dispose), Anfrage verworfen');
  }
});

section('nie blockiert: Tick-Durchsatz bleibt mit langsamem und totem Modell', async () => {
  sitzungSauber();
  const langsam = { name: 'langsam', async call() { await sleep(400); return { text: '{"befehle": [], "begruendung": "spät"}', usage: { input: 10, output: 5 }, sec: 0.4 }; } };
  const t = spiel(), b = spiel();
  const sl = LS.create(t.g, { llm: LLM.create({ mode: 'live', transport: langsam }), werte: {} });
  t.g.lageSchalter = true;
  t.g.lageSpielleiter = sl; t.g.lageSchalter = true;   // Einsetzen wie createLageSpielleiter (der Schalter-Zustand ist je Spiel gemerkt)
  const alt = process.env.LLM_LIVE; process.env.LLM_LIVE = '1';
  try {
    for (let i = 0; i < 5; i++) { t.g.step(); b.g.step(); }
    tick(t.g, 2); sl.beiGrenze('andocken');
    const N = 600;
    let t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) t.g.step();
    const mitMs = Number(process.hrtime.bigint() - t0) / 1e6;
    t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) b.g.step();
    const ohneMs = Number(process.hrtime.bigint() - t0) / 1e6;
    ok(sl.zustand === 'laeuft', 'die Anfrage ist noch in der Luft, während 600 Schritte (20 s Spielzeit) liefen');
    ok(mitMs < ohneMs * 3 + 150, `600 Schritte mit offener Anfrage ${mitMs.toFixed(0)} ms, ohne Spielleiter ${ohneMs.toFixed(0)} ms: der Durchsatz bleibt`);
    await sleep(500); t.g.step();
    ok(sl.zustand === 'idle' && lageEintraege(t.g, 'angewandt').length === 1, 'die Antwort wird erst im nächsten Schritt abgeholt und angewandt');
    const e = lageEintraege(t.g, 'angewandt')[0];
    ok(e.tokens === 15 && e.dauer_s === 0.4, 'Messung im Logbuch: Tokens (15) und Dauer (0,4 s) je Plan');
  } finally { if (alt === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = alt; }
});

section('späte und veraltete Antworten', async () => {
  sitzungSauber();
  // 1. Timeout, dann kommt die Antwort doch: verworfen (Token-Abgleich), Logbuch
  const t = spiel(); const { sl, llm } = mitLage(t, { mode: 'script', script: { lage: [{ hold: true, json: { befehle: [], fokus: { hex: '0105', radius: 2 }, begruendung: 'zu spät' }, tokens: 123 }] } }, { timeout_s: 1 });
  tick(t.g); sl.beiGrenze('andocken'); await pumpen(t.g, 90);
  ok(lageEintraege(t.g, 'fehler').length === 1 && sl.zustand === 'idle', 'Timeout in Spielzeit: Störung, wieder frei');
  llm.release(); await pumpen(t.g, 3);
  ok(lageEintraege(t.g, 'verspaetet').length === 1 && lageEintraege(t.g, 'verspaetet')[0].tokens === 123 && ws(t.g).regie.vorgemerkt.length === 0 && lageEintraege(t.g, 'angewandt').length === 0, 'späte Antwort: verworfen, Tokens im Logbuch, nichts vorgemerkt');
  // 2. neue Anfrage nach der Störung: der alte Token stört nicht
  tick(t.g, W.min_abstand_ticks + 1);
  ok(sl.beiGrenze('andocken').gestartet, 'danach ist der Spielleiter wieder frei');
  await pumpen(t.g, 4);
  ok(lageEintraege(t.g, 'angewandt').length === 1, 'die neue Antwort wird angewandt');
  // 2b. Token-Abgleich: die späte Antwort der ersten Anfrage trifft ein, während schon eine zweite läuft – sie darf die zweite nicht beenden und nichts anwenden
  sitzungSauber();
  {
    const u = spiel(); const { sl: su, llm: lu } = mitLage(u, { mode: 'script', script: { lage: [{ hold: true, json: { befehle: [], fokus: { hex: '0105', radius: 2 }, begruendung: 'erste' } }, { hold: true, json: { befehle: [], begruendung: 'zweite' } }] } }, { timeout_s: 1 });
    tick(u.g); su.beiGrenze('andocken'); await pumpen(u.g, 90);
    tick(u.g, W.min_abstand_ticks + 1); su.beiGrenze('andocken'); await pumpen(u.g, 3);
    ok(su.zustand === 'laeuft' && lu.pending() === 2, 'zweite Anfrage läuft, die erste hängt noch');
    lu.release(1); await pumpen(u.g, 3);
    ok(su.zustand === 'laeuft' && lageEintraege(u.g, 'angewandt').length === 0 && lageEintraege(u.g, 'verspaetet').length === 1 && ws(u.g).regie.vorgemerkt.length === 0, 'die Antwort der ersten (anderer Token) wird verworfen, die zweite läuft weiter');
    lu.release(1); await pumpen(u.g, 3);
    ok(lageEintraege(u.g, 'angewandt').length === 1 && lageEintraege(u.g, 'angewandt')[0].begruendung === 'zweite', 'die Antwort der zweiten wird angewandt');
  }
  // 3. veraltet: die Sim läuft weiter, bis die Antwort kommt
  sitzungSauber();
  const v = spiel(); const { sl: sv, llm: lv } = mitLage(v, { mode: 'script', script: { lage: [{ json: { befehle: [], fokus: { hex: '0105', radius: 2 }, begruendung: 'schon alt' } }, { json: { befehle: [{ typ: 'regler', fraktion: 'ger', aggr: 0.5, dauer: 8 }], begruendung: 'nr 2' } }] } }, { min_abstand_ticks: 1 });
  sv.beiGrenze('andocken'); await pumpen(v.g, 3);   // erste Anfrage (sofort fertig, wird gleich angewandt)
  ok(lageEintraege(v.g, 'angewandt').length === 1 && ws(v.g).regie.vorgemerkt.length >= 1, 'erster Plan angewandt (vorgemerkt)');
  const vorher = JSON.stringify(ws(v.g).regie.vorgemerkt);
  // zweiter Plan: Anfrage in der Luft (hold), die Sim läuft weiter
  lv.calls(); sv.W = Object.assign({}, sv.W);   // (Script-Eintrag 2 ist nicht „hold“: wir halten über eine eigene Schleife)
  const hold = LLM.create({ mode: 'script', script: { lage: [{ hold: true, json: { befehle: [{ typ: 'regler', fraktion: 'ger', aggr: 0.5, dauer: 8 }], begruendung: 'nr 2' } }] } });
  sv.llm = hold; tick(v.g, 1); sv.beiGrenze('andocken'); await pumpen(v.g, 3);
  tick(v.g, W.plan_alter_max_ticks + 1);
  hold.release(); await pumpen(v.g, 3);
  ok(lageEintraege(v.g, 'veraltet').length === 1 && sv.zaehler.veraltet === 1, 'Plan kam nach mehr als ' + W.plan_alter_max_ticks + ' Ticks: veraltet, verworfen');
  ok(lageEintraege(v.g, 'angewandt').length === 1 && eintraege(v.g, 'lage_befehl', 'rueckfall').length === 0, 'kein Rückfall: der frühere, geprüfte Plan bleibt');
  ok(v.g.errors === 0, 'keine Serverfehler');
  void vorher; void lv;
});

section('Namensfilter: Freitext ja, Struktur nie (Spieler „Rom“, „01“, „an“, „flotten“, „Crew“)', () => {
  const strukturOhneChronik = (prompt) => { const o = JSON.parse(prompt.match(/<ausschnitt>\n([\s\S]*?)\n<\/ausschnitt>/)[1]); delete o.chronik; return o; };
  const basis = spiel({ crew: 1, names: ['Zyxwvut'] });
  tick(basis.g, 12);
  const soll = strukturOhneChronik(Prompt.baue(basis.g, { art: 'andocken', nr: 1, letzte: [], werte: W }).prompt);
  for (const name of ['Rom', '01', 'an', 'flotten', 'Crew', 'ger', 'h', 'st']) {
    const t = spiel({ crew: 1, names: [name] });
    tick(t.g, 12);
    t.g.weltsim.chronik = [{ t: 12, art: 'plan', ref: 'p1', kurz: `${name} hat den Posten gegründet` }];   // SUND-03 D: welt.sim.chronik
    const b = Prompt.baue(t.g, { art: 'andocken', nr: 1, letzte: [{ nr: 1, begruendung: `${name} hat gewonnen`, grenze: 'andocken', befehle: ['fokus ger'] }], werte: W });
    const ist = strukturOhneChronik(b.prompt);
    ok(gleich(ist, soll), `Spieler „${name}“: der Ausschnitt ist strukturell identisch (Schlüssel, Fraktionen, Hex-Codes, Anzahl unberührt)`);
    if (name.length >= 2) {
      const chron = JSON.parse(b.prompt.match(/<ausschnitt>\n([\s\S]*?)\n<\/ausschnitt>/)[1]).chronik;
      const plaene = JSON.parse(b.prompt.match(/<letzte_plaene>\n([\s\S]*?)\n<\/letzte_plaene>/)[1]);
      ok(chron.length === 1 && /^[0-9]+: Crew hat/.test(chron[0]) && plaene[0].begruendung === 'Crew hat gewonnen' && plaene[0].grenze === 'andocken' && plaene[0].befehle[0] === 'fokus ger', `Spieler „${name}“: im Freitext (Chronik, letzte Pläne) steht „Crew“, Felder und Befehle bleiben`);
    }
  }
});

section('Antwort lesen: erstes Objekt in Plan-Form', () => {
  const r = Prompt.planAusText('Ich wäge {Rom gegen Germanen} ab. Mein Plan: {"befehle": [], "begruendung": "ruhig"} {"anderes": 1}');
  ok(r.plan && r.plan.begruendung === 'ruhig', 'Klammern im Text vor dem Plan stören nicht (jedes „{“ wird probiert)');
  ok(gleich(Prompt.planAusText('Beispiel {"a": 1}').plan, { a: 1 }), 'ohne Plan-Form: das erste lesbare Objekt (die Prüfung lehnt es mit Grund ab)');
  ok(Prompt.planAusText('{"befehle": [], "fokus": {"hex": "0105", "radius": 2}}').plan.fokus.radius === 2, 'verschachtelte Objekte bleiben im Plan');
});

section('Timeout und Abbruch: Einheit, AbortSignal bis in den Transport', async () => {
  sitzungSauber();
  const alt = process.env.LLM_LIVE; process.env.LLM_LIVE = '1';
  try {
    const protokoll = [];
    const fake = { name: 'fake', call(text, o) { return new Promise((resolve, reject) => { protokoll.push(o); if (o.signal) o.signal.addEventListener('abort', () => { const e = new Error('abgebrochen'); e.code = 'ABORTED'; reject(e); }, { once: true }); }); } };
    const t = spiel(); const sl = LS.create(t.g, { llm: LLM.create({ mode: 'live', transport: fake }), werte: {} });
    t.g.lageSpielleiter = sl; t.g.lageSchalter = true;
    tick(t.g); sl.beiGrenze('andocken'); await pumpen(t.g, 3);
    ok(protokoll.length === 1 && protokoll[0].timeoutMs === W.timeout_s * 1000 && protokoll[0].timeoutMs >= 1000, `timeoutMs im Transport in Millisekunden (${protokoll[0] && protokoll[0].timeoutMs}, Daten ${W.timeout_s} s)`);
    ok(protokoll[0].signal && protokoll[0].signal.aborted === false, 'ein AbortSignal geht bis in den Transport');
    sl.dispose();
    await pumpen(t.g, 2);
    ok(protokoll[0].signal.aborted === true, 'dispose bricht den Transport ab');
    ok(lageEintraege(t.g, 'verspaetet').length === 0 && t.g.errors === 0, 'der eigene Abbruch ist keine späte Antwort und kein Fehler');
    // Timeout in Spielzeit bricht ebenfalls ab
    const t2 = spiel(); const p2 = []; const fake2 = { name: 'fake2', call(text, o) { return new Promise((res, rej) => { p2.push(o); o.signal.addEventListener('abort', () => rej(Object.assign(new Error('abgebrochen'), { code: 'ABORTED' })), { once: true }); }); } };
    const s2 = LS.create(t2.g, { llm: LLM.create({ mode: 'live', transport: fake2 }), werte: { timeout_s: 1 } });
    t2.g.lageSpielleiter = s2; t2.g.lageSchalter = true;
    tick(t2.g); s2.beiGrenze('andocken'); await pumpen(t2.g, 90);
    ok(p2[0].signal.aborted && lageEintraege(t2.g, 'fehler').length === 1 && /ETIMEDOUT/.test(lageEintraege(t2.g, 'fehler')[0].fehler[0]) && lageEintraege(t2.g, 'verspaetet').length === 0, 'Timeout in Spielzeit: Transport abgebrochen, ein Fehlereintrag, keine späte Antwort');
    ok(t2.g.errors === 0, 'keine Serverfehler');
  } finally { if (alt === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = alt; }
  // llm.js reicht das Signal an den CLI-Transport (callClaude) und damit an den Prozess: Quelltext-Naht
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'mission', 'llm.js'), 'utf8');
  ok(/signal\.addEventListener\('abort', abbrechen/.test(src) && /o\.signal\)/.test(src) && /co\.signal = ao\.signal/.test(src), 'llm.js: Signal bis callClaude (Prozess wird beendet)');
});

section('Budget leer: Rückfall und Logbuch nur einmal; ENOENT: nur ein Versuch', async () => {
  sitzungSauber(); LLM.setBudgetLimit(W.min_budget - 1);
  const t = spiel(); const { sl, llm } = mitLage(t, {}, { min_abstand_ticks: 1 });
  const rueck = () => eintraege(t.g, 'lage_befehl', 'rueckfall').length;
  tick(t.g); const a = sl.beiGrenze('andocken'); tick(t.g); const b = sl.beiGrenze('andocken'); tick(t.g); const c = sl.beiGrenze('absicht');
  ok(a.grund === 'budget' && b.grund === 'budget' && c.grund === 'budget' && llm.asks.length === 0, 'Budget leer: keine Anfrage');
  ok(rueck() === 1 && lageEintraege(t.g, 'fehler').filter((e) => e.fehler[0] === 'BUDGET').length === 1, 'genau ein Rückfall und ein BUDGET-Eintrag, nicht je Grenze');
  ws(t.g).regie.vorgemerkt.push({ b: { typ: 'regler', fraktion: 'ger', aggr: 0.5, dauer: 8 }, ab: 99 });
  tick(t.g); sl.beiGrenze('andocken');
  ok(ws(t.g).regie.vorgemerkt.length === 1, 'weitere Grenzen rühren die Regie nicht mehr an');
  LLM.resetBudget(); tick(t.g); ok(sl.beiGrenze('andocken').gestartet, 'Budget wieder da: es geht weiter');
  await pumpen(t.g, 4); LLM.setBudgetLimit(W.min_budget - 1); tick(t.g, 2);
  ok(sl.beiGrenze('andocken').grund === 'budget' && rueck() === 2, 'wird das Budget später wieder leer, meldet der Rückfall es erneut (einmal je Zustand)');
  sitzungSauber();
  // ENOENT: Transport aus, die nächsten Grenzen versuchen es nicht erneut
  const u = spiel(); const { sl: su, llm: lu } = mitLage(u, { mode: 'script', script: { lage: [{ error: 'enoent' }, { json: { befehle: [], begruendung: 'x' } }, { json: { befehle: [], begruendung: 'y' } }] } }, { min_abstand_ticks: 1, deckel_je_sitzung: 10 });
  const gr = [];
  for (let i = 0; i < 4; i++) { tick(u.g, 2); gr.push(su.beiGrenze('andocken').grund); await pumpen(u.g, 3); }
  ok(lu.asks.length === 1 && su.aus && gr.slice(1).every((g) => g === 'transport_aus') && su.zaehler.uebersprungen.transport_aus === 3, 'ENOENT (CLI fehlt): genau ein Versuch, danach transport_aus');
});

section('Hooks: Szenenende nur nach gelungenem Tick, Hook wirft nie, Logbuch ohne Flut', async () => {
  const t = spiel({ env: AN }); for (let i = 0; i < 5; i++) t.g.step();
  const sl = t.g.lageSpielleiter; const ruft = []; const o = sl.beiGrenze.bind(sl); sl.beiGrenze = (a) => { ruft.push(a); return o(a); };
  const kernAlt = Kern.tick; Kern.tick = function () { throw new Error('Test: Tick wirft'); };
  let r; try { r = Kriegslage.szeneAbschliessen(t.g, { wirkungen: [], wo: 'szene' }); } finally { Kern.tick = kernAlt; }
  ok(r.ok === false && ruft.length === 0, 'Szenenende, dessen Tick scheitert: keine Grenze');
  sl.beiGrenze = () => { throw new Error('Test: beiGrenze wirft'); };
  let wirft = false, res; try { res = t.g.lageGrenze('andocken'); } catch (e) { wirft = true; }
  ok(!wirft && res === null && t.g.errors >= 1, 'game.lageGrenze fängt eine Ausnahme des Spielleiters ab und zählt sie');
  // Flut: viele Grenzen im selben Tick und mit demselben Grund: ein Eintrag
  sitzungSauber();
  const u = spiel(); const { sl: su } = mitLage(u, {}); tick(u.g); su.beiGrenze('andocken');
  for (let i = 0; i < 20; i++) su.beiGrenze('andocken');
  ok(su.zaehler.uebersprungen.abstand === 20 && lageEintraege(u.g, 'uebersprungen').length === 1 && lageEintraege(u.g, 'uebersprungen')[0].grund === 'abstand', '20 Grenzen im selben Tick: gezählt 20, ein Logbucheintrag mit Feld grund');
  tick(u.g); su.beiGrenze('andocken');
  ok(lageEintraege(u.g, 'uebersprungen').length === 2, 'im nächsten Tick wieder ein Eintrag');
});

section('Plan-Alter: genau die Grenze gilt noch', async () => {
  sitzungSauber();
  const mk = async (ticks) => {
    const u = spiel(); const { sl, llm } = mitLage(u, { mode: 'script', script: { lage: [{ hold: true, json: { befehle: [], fokus: { hex: '0105', radius: 2 }, begruendung: 'alt' } }] } });
    tick(u.g); sl.beiGrenze('andocken'); await pumpen(u.g, 3); tick(u.g, ticks); llm.release(); await pumpen(u.g, 3);
    return u;
  };
  const genau = await mk(W.plan_alter_max_ticks), zuviel = await mk(W.plan_alter_max_ticks + 1);
  ok(lageEintraege(genau.g, 'angewandt').length === 1 && lageEintraege(genau.g, 'veraltet').length === 0, `Alter genau ${W.plan_alter_max_ticks}: der Plan gilt noch`);
  ok(lageEintraege(zuviel.g, 'veraltet').length === 1 && lageEintraege(zuviel.g, 'angewandt').length === 0, `Alter ${W.plan_alter_max_ticks + 1}: verworfen`);
});

section('Bericht: übersprungene Grenzen nach Grund, Rückfall-Hinweis', () => {
  const dir = path.join(F.TMP, 'bericht-lage'); fs.mkdirSync(dir, { recursive: true });
  const log = Regielog.create({ dir, weltId: 'w-lage' });
  const e = (grund) => log.write({ art: 'lage_grobplan', ausgang: 'uebersprungen', grund, begruendung: 'Grenze andocken: kein Plan (' + grund + ')', plan: { sitzung: 's1' } });
  for (const g of ['deckel', 'deckel', 'abstand', 'beschaeftigt', 'beschaeftigt', 'beschaeftigt']) e(g);
  const md = Bericht.report(dir, 'w-lage');
  ok(/deckel 2/.test(md) && /abstand 1/.test(md) && /beschaeftigt 3/.test(md), 'Bericht unterscheidet deckel, abstand, beschaeftigt');
  ok(/Rückfall räumt Fokus und Regler/.test(md), 'Hinweis im Bericht: ein Rückfall räumt Fokus/Regler früherer Pläne mit ab');
});

section('Rückfall: Entwarnung für angekündigte, nie gekommene Befehle', async () => {
  sitzungSauber();
  const t = spiel();
  const { sl } = mitLage(t, { mode: 'script', script: { lage: [{ json: { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['M'], dauer: 6 }], begruendung: 'Sperre' } }, { error: 'exit' }] } }, { min_abstand_ticks: 1 });
  for (let i = 0; i < 2; i++) ws(t.g).ereignisse.push({ n: ws(t.g).tickZahl, typ: 'hafen_gefallen', fraktion: 'rom', ort: '0105', ortName: 'Carrara', alt: 'ger', neu: 'rom' });
  tick(t.g); sl.beiGrenze('andocken'); await pumpen(t.g, 4);
  const vor = t.funk().length;
  ok(ws(t.g).regie.vorgemerkt.some((e) => e.w === 1) && vor >= 1, 'Plan angenommen, die Vorwarnung ging per Funk');
  tick(t.g); sl.beiGrenze('andocken'); await pumpen(t.g, 4);
  ok(ws(t.g).regie.vorgemerkt.length === 0 && eintraege(t.g, 'lage_befehl', 'rueckfall').length === 1, 'zweiter Aufruf scheitert: Rückfall, nichts wartet');
  const neu = t.funk().slice(vor);
  ok(neu.length === 1 && /nicht|abgeblasen|entf|Entwarnung|Sperre/i.test(neu[0]), 'beim Rückfall kommt genau eine Entwarnung per Funk: ' + (neu[0] || '').slice(0, 70));
});

section('Debug-Kommandos lage status | plan | fail', async () => {
  sitzungSauber();
  const aus = spiel(), an = spiel({ env: AN });
  const sage = (t, args) => { const alt = t.cs[0].inbox.length; t.g.handleMessage(t.cs[0], { t: 'debug', cmd: 'lage', args }); return t.cs[0].inbox.slice(alt).filter((m) => m.t === 'event' && m.kind === 'notice').map((m) => m.text).join(' | '); };
  for (let i = 0; i < 5; i++) { aus.g.step(); an.g.step(); }
  ok(/Kein Lage-Spielleiter/.test(sage(aus, 'status')), 'ohne Schalter: Hinweis statt Absturz');
  ok(/Lage-Spielleiter: Modus mock, Zustand idle, Anfragen 0\/6/.test(sage(an, 'status')), 'status');
  tick(an.g, 2);
  ok(/Plan angefragt/.test(sage(an, 'plan')), 'plan fordert eine Anfrage an (ohne Abstand und Deckel)');
  await pumpen(an.g, 4);
  ok(lageEintraege(an.g, 'angewandt').length === 1 && an.g.lageSpielleiter.aufrufe === 1, 'der Plan läuft durch');
  ok(/kein Plan \(abstand/.test('lage: kein Plan (abstand)') && /Plan angefragt/.test(sage(an, 'plan')), 'plan umgeht den Abstand');
  await pumpen(an.g, 4);
  ok(/scheitert/.test(sage(an, 'fail')), 'fail: nächste Anfrage scheitert');
  tick(an.g, W.min_abstand_ticks + 1);
  an.g.lageGrenze('andocken'); await pumpen(an.g, 3);
  ok(lageEintraege(an.g, 'fehler').length === 1 && /Debug: lage fail/.test(lageEintraege(an.g, 'fehler')[0].fehler[0]) && eintraege(an.g, 'lage_befehl', 'rueckfall').length === 1, 'fail: Fehler und Rückfall im Logbuch');
  ok(/status \| plan \| fail/.test(sage(an, 'quatsch')), 'unbekannte Unterkommandos nennen die Möglichkeiten');
  an.g.debug = false;
  ok(/deaktiviert/.test(sage(an, 'status')), 'ohne Debug-Modus nicht erreichbar');
  ok(an.g.errors === 0 && aus.g.errors === 0, 'keine Serverfehler');
});

section('Logbuch und Bericht', async () => {
  sitzungSauber();
  const t = spiel(); const { sl } = mitLage(t, { mode: 'script', script: { lage: [{ json: { befehle: [], begruendung: 'a' }, tokens: 100 }, { error: 'exit' }, { text: 'Müll' }, { json: { befehle: [], begruendung: 'b' }, tokens: 300 }] } }, { min_abstand_ticks: 1 });
  for (let i = 0; i < 4; i++) { tick(t.g, 2); sl.beiGrenze('andocken'); await pumpen(t.g, 3); }
  const alle = lageEintraege(t.g);
  ok(alle.length === 4 && alle.every((e) => e.plan && e.plan.sitzung && e.plan.grenze === 'andocken' && e.plan.nr >= 1 && e.plan.zeichen > 1000), 'je Aufruf ein Eintrag mit Grenze, Nummer, Sitzung, Promptgröße');
  ok(alle.filter((e) => e.ausgang === 'angewandt').length === 2 && alle.filter((e) => e.ausgang === 'fehler').length === 2, 'zwei angewandt, zwei Fehler');
  ok(alle.every((e) => Number.isFinite(e.dauer_s) && e.tokens >= 0) && alle.reduce((s, e) => s + e.tokens, 0) === 400, 'Dauer und Tokens je Aufruf (Summe 400)');
  const dir = Regielog.dir(t.g.env), id = t.g.weltstand.id;
  const md = Bericht.report(dir, id);
  ok(/## Lage-Spielleiter/.test(md) && /Aufrufe je Sitzung/.test(md) && /Median/.test(md) && /p90/.test(md) && /Fehler: 2/.test(md) && /Rückfälle: 2/.test(md), 'npm run regie: Abschnitt Lage-Spielleiter mit Aufrufen je Sitzung, Median/p90, Fehlern, Rückfällen');
  ok(/Tokens gesamt: \*\*400\*\*/.test(md), 'Tokens gesamt zählt die Lage-Aufrufe');
  ok(/Aufrufe: \*\*4\*\* in 1 Sitzung/.test(md), 'Aufrufe zählt Angewandte und Fehler (4 in 1 Sitzung)');
});

section('Mehrspieler zu dritt: Protokoll und Snapshot unberührt, Funk für alle', async () => {
  sitzungSauber();
  const ohne = spiel({ crew: 3, names: NAMEN }), mit = spiel({ crew: 3, names: NAMEN, env: AN });
  for (const t of [ohne, mit]) { for (let i = 0; i < 60; i++) t.g.step(); }
  const sl = mit.g.lageSpielleiter;
  sl.llm = LLM.create({ mode: 'script', script: { lage: [{ json: { befehle: [], fokus: { hex: '0105', radius: 2 }, begruendung: 'Zug' } }] } });
  ok(!!sl && mit.g.players.length === 3, 'ein Lage-Spielleiter je Spiel, drei Spieler');
  const MaxProm = []; const orig = sl.llm.ask.bind(sl.llm); sl.llm.ask = (k, i, o) => { MaxProm.push(i.prompt); return orig(k, i, o); };
  tick(mit.g, 3); tick(ohne.g, 3);
  mit.g.missionEvent('docked', { loc: 'x' });
  for (let i = 0; i < 90; i++) { mit.g.step(); ohne.g.step(); await frei(); }
  ok(MaxProm.length === 1 && !new RegExp(NAMEN.map((n) => n.split('_')[0]).join('|'), 'i').test(MaxProm[0]) && /"anzahl":3/.test(MaxProm[0]), 'der Prompt für drei Spieler trägt nur die Anzahl, keine Namen');
  const arten = (t) => new Set(t.cs.flatMap((c) => c.inbox.map((m) => m.t + (m.kind ? ':' + m.kind : ''))));
  const mehr = [...arten(mit)].filter((k) => !arten(ohne).has(k));
  ok(mehr.length === 0, 'keine neue Nachrichtenart an die Clients (Protokoll unberührt)' + (mehr.length ? ': ' + mehr.join(', ') : ''));
  const json = JSON.stringify(mit.cs[0].inbox);
  ok(!/lage_grobplan|letzte_plaene|lageSpielleiter/.test(json), 'nichts vom Lage-Spielleiter in den Nachrichten an die Clients');
  ok(lageEintraege(mit.g, 'angewandt').length === 1 && mit.g.errors === 0, 'der Plan lief durch, kein Serverfehler');
  // Vorwarnung: ein Plan mit Wirkung auf Rom wird allen drei gefunkt (Paket A, hier nur der Anschluss)
  const fk = (t) => t.cs.map((c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'radio').length);
  const vorher = fk(mit);
  const ziel = Object.keys(z(mit.g).hexe).find((c) => z(mit.g).hexe[c].besitzer === 'rom' && !Object.values(Kern.datenVon(z(mit.g)).hauptwelten).includes(c));
  const res = Regie.planPruefen(mit.g, { befehle: [{ typ: 'piratenueberfall', ort: ziel }] });
  ok(res.ok, 'Probelauf eines Plans mit Wirkung auf Rom ist lesbar');
  void vorher;
});

(async () => {
  for (const [name, fn] of abschnitte) {
    if (!gewaehlt(name)) continue;
    console.log('\n' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
  }
  LLM.resetBudget();
  console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})();
