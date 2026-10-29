'use strict';
// SUND-04b A2: Messwerkzeug der Abenteuer-Komposition (server/sim/abenteuer-spielleiter.js). Laesst N Aufrufe durch die echte Kette laufen (Prompt -> Antwort -> Lesen -> expandiere -> Pruefer -> abenteuerAnbieten)
// und gibt aus: Gueltigkeit, Ablehnquote je Code, Wiederholungsrate (gleiche Typenfolge wie die vorige lesbare Antwort), Tokens, Dauer, Geld.
//   node tools/messe-abenteuer.js [--n 200]                                  Mock, ohne Netz (Standard N=200)
//   node tools/messe-abenteuer.js --live [--n 10]                            bis zu 10 echte Claude-Aufrufe; nur mit LLM_LIVE=1 UND gefundener CLI, sonst uebersprungen (nicht gemessen)
//   node tools/messe-abenteuer.js --anbieter ollama --modell <m> [--n 10]    anderer Anbieter (Ollama auf Sleipnir ueber den ssh-Tunnel, OLLAMA_URL, Standard http://127.0.0.1:11435); nur wenn erreichbar, sonst uebersprungen
//   node tools/messe-abenteuer.js --anbieter claude --modell <m>             Claude mit anderem Modell (wie --live, braucht LLM_LIVE=1)
// Exit 0 (auch bei uebersprungenen Messungen: die Meldung steht in der Ausgabe), Exit 2 bei falschem Aufruf. Die Messwerte der echten Anbieter sind nur so gut wie die Zahl der Aufrufe: ab 10 Aufrufen aussagekraeftig, nicht mehr.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const LLM = require('../server/mission/llm.js');
const Router = require('../server/mission/transport-router.js');
const Ollama = require('../server/mission/transport-ollama.js');
const LS = require('../server/sim/lage-spielleiter.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const Faden = require('../server/sim/faden.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const fmt = (x, d) => (Number.isFinite(x) ? (Math.round(x * (d || 1)) / (d || 1)).toLocaleString('de-DE') : '–');
const prozent = (a, b) => (b ? fmt((100 * a) / b, 10) + ' %' : '–');
const frei = () => new Promise((r) => setImmediate(r));

const live = flag('live');
const anbieter = wert('anbieter');
const modell = wert('modell');
const nArg = wert('n') !== undefined ? Number(wert('n')) : null;
function aufrufPruefen() {
  if (anbieter !== undefined && !['claude', 'ollama'].includes(anbieter)) { console.error(`unbekannter Anbieter "${anbieter}" (erlaubt: claude, ollama)`); process.exit(2); }
  if (nArg !== null && !(Number.isInteger(nArg) && nArg >= 1 && nArg <= 5000)) { console.error('--n: ganze Zahl 1 bis 5000'); process.exit(2); }
}

// gleiche Typenfolge wie die vorige: Anzahl der Wiederholungen hintereinander
function wiederholungen(folgen) { let n = 0; for (let i = 1; i < folgen.length; i++) if (folgen[i] === folgen[i - 1]) n++; return n; }

async function main() {
  aufrufPruefen();
  let modus = 'mock', llm = null, N = nArg || 200, bezeichnung = 'Mock (deterministisch, ohne Netz)';
  const alteLive = process.env.LLM_LIVE;
  if (live || anbieter === 'claude') {
    N = Math.min(nArg || 10, 10);
    const cli = LLM.claudeFinden();
    if (process.env.LLM_LIVE !== '1') { console.log('Messung Claude: nicht gemessen (LLM_LIVE=1 ist nicht gesetzt; echte Aufrufe kosten Geld und laufen nur von Hand).'); return; }
    if (!cli.cmd) { console.log(`Messung Claude: nicht gemessen (Claude-CLI nicht gefunden; versucht: ${cli.versucht.join(', ') || 'nichts'}; CLAUDE_CLI setzen).`); return; }
    modus = 'live';
    const router = Router.routeTransport({ bauplan: { anbieter: 'claude', modell: modell || 'sonnet' } }, { eskalation: null });
    llm = LLM.create({ mode: 'live', transport: router });
    bezeichnung = `Claude (${modell || 'sonnet'}), echte Aufrufe, hoechstens 10`;
  } else if (anbieter === 'ollama') {
    N = Math.min(nArg || 10, 50);
    const g0 = await Ollama.gesund({});
    if (!g0.ok) { console.log(`Messung Ollama: nicht gemessen (Dienst nicht erreichbar: ${g0.url}, ${g0.fehler}; der ssh-Tunnel auf Sleipnir muss stehen, OLLAMA_URL setzen).`); return; }
    process.env.LLM_LIVE = '1';   // lokal und kostenlos: der Schutz gilt den bezahlten Aufrufen
    modus = 'live';
    const router = Router.routeTransport({ bauplan: { anbieter: 'ollama', modell } }, { eskalation: null });
    llm = LLM.create({ mode: 'live', transport: router });
    bezeichnung = `Ollama (${modell || Ollama.DEFAULT_MODEL}) auf ${g0.url}, Version ${g0.version || '?'}`;
  } else {
    llm = LLM.create({ mode: 'mock' });
  }

  const t = F.neuesSpiel({ crew: 1, seed: 7, names: ['Messung'], env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: modus === 'live' ? 'mock' : 'mock' } });
  const g = t.g;
  for (let i = 0; i < 6; i++) g.step();
  const sl = LS.create(g, { llm, abenteuerWerte: { deckel_je_sitzung: 1e9, cooldown_grenzen: 0, timeout_s: modus === 'live' ? 300 : 120 } });
  g.lageSpielleiter = sl; g.lageSchalter = true;
  const ab = sl.abenteuer;
  const roh = [];
  const ask0 = llm.ask.bind(llm);
  llm.ask = async (k, i, o) => { const r = await ask0(k, i, o); if (k === 'abenteuer') roh.push(r.text); return r; };

  const zaehl = { gueltig: 0, abgelehnt: {}, ausfall: {}, tokens: 0, dauer: [], geld: 0, geldBekannt: 0 };
  const folgen = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const z = Faden.zustandVon(g); z.abenteuerAngebote.length = 0;
    const r = ab.erzwingen();
    if (!r.gestartet) { console.log(`Aufruf ${i + 1}: nicht gestartet (${r.grund})`); break; }
    const grenze = Date.now() + (modus === 'live' ? 6 * 60 * 1000 : 5 * 1000);
    while (ab.zustand !== 'idle' && Date.now() < grenze) { g.step(); await frei(); if (modus === 'live') await new Promise((s) => setTimeout(s, 25)); }
    if (ab.zustand !== 'idle') { console.log(`Aufruf ${i + 1}: haengt (nach ${modus === 'live' ? 6 * 60 : 5} s kein Ergebnis), die Messung bricht ab`); zaehl.ausfall.HAENGT = 1; break; }
    const e = (g.lageRegie ? g.lageRegie.log.entries : []).filter((x) => x.art === 'abenteuer_bauplan' && ['gueltig', 'abgelehnt', 'ausfall'].includes(x.ausgang) && x.plan && x.plan.nr === ab.aufrufe).pop();   // das Logbuch im Speicher haelt nur die letzten 200 Eintraege: ueber die Nummer des Aufrufs suchen
    if (!e) { zaehl.ausfall.KEIN_ERGEBNIS = (zaehl.ausfall.KEIN_ERGEBNIS || 0) + 1; continue; }
    if (e.ausgang === 'gueltig') zaehl.gueltig++;
    else if (e.ausgang === 'abgelehnt') zaehl.abgelehnt[e.grund] = (zaehl.abgelehnt[e.grund] || 0) + 1;
    else zaehl.ausfall[e.grund] = (zaehl.ausfall[e.grund] || 0) + 1;
    zaehl.tokens += e.tokens || 0;
    if (Number.isFinite(e.dauer_s)) zaehl.dauer.push(e.dauer_s);
    if (Number.isFinite(e.geld)) { zaehl.geld += e.geld; zaehl.geldBekannt++; }
    const gelesen = roh.length ? AP.bauplanAusText(roh[roh.length - 1]) : null;
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
  console.log(`Tokens: ${fmt(zaehl.tokens)} (je Aufruf ${gesamt ? fmt(zaehl.tokens / gesamt) : '–'}); Dauer je Aufruf: Median ${fmt(dauer[Math.floor(dauer.length / 2)], 100)} s, max ${fmt(dauer[dauer.length - 1], 100)} s; Geld: ${zaehl.geldBekannt ? (Math.round(zaehl.geld * 10000) / 10000).toLocaleString('de-DE', { maximumFractionDigits: 4 }) + ' USD' : 'nicht gemeldet'}; Laufzeit ${fmt((Date.now() - t0) / 1000, 10)} s`);
  if (modus === 'mock') console.log('Hinweis: Mock-Werte pruefen die Kette und das Werkzeug; sie sagen nichts ueber die Qualitaet eines echten Modells (dafuer --live bzw. --anbieter).');
  g.errors && console.log(`Serverfehler im Lauf: ${g.errors}`);
  sl.dispose();
}
if (require.main === module) main().then(() => process.exit(0), (e) => { console.error('Abbruch: ' + (e && e.stack)); process.exit(1); });
module.exports = { wiederholungen, prozent };
