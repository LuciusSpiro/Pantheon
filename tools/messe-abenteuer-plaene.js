'use strict';
// SUND-04b E4: Messung ueber viele erzeugte Abenteuer-Plaene (Gueltigkeit, Wiederholung, Typverteilung, Kosten je Abenteuer und je Abend; Abnahmekriterien 3, 5 und 11). Ergaenzt tools/messe-abenteuer.js (das misst die
// Komposition eines Anbieters je Aufruf): dieses Werkzeug laesst N Plaene durch die ECHTE Kette laufen und fuehrt dabei ein Spiel weiter, damit die Wiederholungsregeln etwas zu tun haben:
//   Prompt (abenteuer-prompt.js, mit Kanon und Sperren) -> Mock-Komposition (abenteuer-mock.js, derselbe Mock wie in llm.js) -> Lesen -> Expander -> Pruefer -> Brett (abenteuerNeuAnbieten, Wiederholungsregeln)
//   -> das Abenteuer wird geoeffnet und zu Ende gebracht (jeder Beat bekommt einen gewuerfelten Ausgang ueber Faden.beatAusgang: Gedaechtnis, Kanon, Chronik laufen wie im Spiel; die Bausteine und Szenen laufen NICHT)
// und nimmt den Kanon mit. Alle Zahlen: gemessen (Mock-Kette) oder GESCHAETZT (Annahme, im Aufruf einstellbar und in der Ausgabe als solche gekennzeichnet). Es gibt keinen erfundenen Messwert: ein echtes Modell
// wird nur mit LLM_LIVE=1 gemessen (dann zusaetzlich ein kleiner Live-Lauf ueber tools/messe-abenteuer.js), sonst steht "nicht live gemessen".
//   node tools/messe-abenteuer-plaene.js [--n 500] [--seed 1] [--grenzen-je-abend 60] [--zeichen-je-token 3] [--preis-je-mtok 3.75] [--live] [--json]
// Annahmen (alle ueberschreibbar): zeichen-je-token 3 (deutscher Text mit JSON: grobe Faustzahl, nicht gemessen), preis-je-mtok 3,75 USD (Mischpreis aus der Live-Messung SUND-03: 0,03 USD je Lage-Plan mit ca. 8 000 Token),
// grenzen-je-abend 60 (Taetigkeitsgrenzen szene_ende, andocken, absicht eines Abends; geschaetzt), Dauer je Claude-Aufruf 7,5 s (SUND-03, Lage-Plan, Median; ein Bauplan ist kuerzer: Obergrenze, nicht gemessen).
// Exit 0 (auch bei uebersprungenen Live-Messungen), Exit 1 bei einer verletzten Pflichtgroesse (ein ungueltiger Plan gespielt, eine Wiederholung im Verlauf, ein Widerspruch im Kanon), Exit 2 bei falschem Aufruf.
const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));
const R = require('./regie-fixture.js');
const D = require('../server/sim/faden-daten.js');
const Faden = require('../server/sim/faden.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const AM = require('../server/sim/abenteuer-mock.js');
const BP = require('../server/sim/faden-bauplan.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Kanon = require('../server/sim/abenteuer-kanon.js');
const Wdh = require('../server/sim/abenteuer-wiederholung.js');
const { WERTE: AW } = require('../server/sim/abenteuer-daten.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const wert = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const zahl = (n, d, lo, hi) => { const v = Number(wert(n, d)); if (!(Number.isFinite(v) && v >= lo && v <= hi)) { console.error(`--${n}: Zahl von ${lo} bis ${hi}`); process.exit(2); } return v; };
const N = zahl('n', 500, 1, 20000), SEED = zahl('seed', 1, 0, 1e9), GRENZEN = zahl('grenzen-je-abend', 60, 1, 10000), ZJT = zahl('zeichen-je-token', 3, 0.5, 20), PREIS = zahl('preis-je-mtok', 3.75, 0, 1000);
const DAUER_CLAUDE_S = 7.5;
const fmt = (x, d) => (Number.isFinite(x) ? (Math.round(x * (d || 1)) / (d || 1)).toLocaleString('de-DE', { maximumFractionDigits: 4 }) : '–');
const pct = (a, b) => (b ? fmt((100 * a) / b, 10) + ' %' : '–');
const quant = (arr, q) => { if (!arr.length) return NaN; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const klon = (x) => JSON.parse(JSON.stringify(x));
function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const folgeVon = (v) => Kanon.typenVon(v).join('>');

function neuesSpiel(seed) {
  const t = R.neuesSpiel({ crew: 1, seed, names: ['Messung'], env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  for (let i = 0; i < 4; i++) t.g.step();
  return t.g;
}
// ein geoeffnetes Abenteuer zu Ende bringen: jeder Beat bekommt einen Ausgang ueber den echten Weg (Faden.beatAusgang)
function beende(g, f, r) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, r() < 0.3 ? 'gescheitert' : 'gelungen');
  }
}

function messen() {
  const r = rng(SEED);
  const HEXE = ['0305', '0306', '0307', '0205', '0202'];
  const Z = { plaene: 0, gueltig: 0, abgelehnt: {}, korrupt: 0, korruptAngenommen: 0, ungueltigGespielt: 0, geoeffnet: 0, wiedersehen: 0, kanonFehler: 0, ausnahmen: 0 };
  const promptZ = [], antwortZ = [], rechenMs = [], typen = {}, folgen = new Map(), ablehnTypen = {};
  const verlauf = [];   // eigene Rechnung: Typenfolge je begonnenem Abenteuer, je Partie
  let rohWiederholt = 0, rohGueltig = 0, wiederholungImVerlauf = 0, ortTypImVerlauf = 0, hauptfigurImVerlauf = 0;
  let g = null, seitStart = 0, partie = 0;
  for (let i = 1; i <= N; i++) {
    if (!g || seitStart >= 36) { g = neuesSpiel(SEED * 1000 + (++partie)); seitStart = 0; verlauf.length = 0; }
    Faden.zustandVon(g).abenteuerAngebote.length = 0;
    const hex = HEXE[Math.floor(r() * HEXE.length)];
    const t0 = process.hrtime.bigint();
    const bau = AP.baue(g, { nr: i, grenze: 'andocken', hex, letzte: [] });
    if (bau.fehler) { Z.ausnahmen++; continue; }
    const e = AM.erzeuge({ prompt: bau.prompt });
    Z.plaene++;
    promptZ.push(bau.zeichen); antwortZ.push(e.text.length);
    if (e.korruption) Z.korrupt++;
    // wie abenteuer-spielleiter.js antwort(): erst die Groesse (die Rohantwort wird gar nicht gelesen), dann das Lesen
    const vorab = !e.text.trim() ? 'ANTWORT_LEER' : e.text.length > AW.antwort_max_zeichen ? 'ANTWORT_ZU_GROSS' : null;
    const gelesen = vorab ? { fehler: vorab } : AP.bauplanAusText(e.text);
    if (gelesen.fehler) { const code = vorab || 'ANTWORT_UNLESBAR'; Z.abgelehnt[code] = (Z.abgelehnt[code] || 0) + 1; rechenMs.push(Number(process.hrtime.bigint() - t0) / 1e6); continue; }
    // Rohlage ohne Wiederholungsregeln: wie oft wuerde die Folge eines gueltigen Plans unter den letzten drei begonnenen stehen?
    const roh = BP.pruefe(gelesen.plan);
    if (roh.ok) { rohGueltig++; if (verlauf.slice(-D.BRETT.werte.wiederholung.folge_zuletzt).some((x) => x.folge === folgeVon(roh.vorlage))) rohWiederholt++; }
    const res = Faden.abenteuerNeuAnbieten(g, gelesen.plan, { hex });
    rechenMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (!res.ok) {
      const code = String(res.grund).split(':')[0];
      Z.abgelehnt[code] = (Z.abgelehnt[code] || 0) + 1;
      if (/^WIEDERHOLUNG/.test(code) && roh.ok) { const typ = Kanon.typenVon(roh.vorlage)[0]; ablehnTypen[typ] = (ablehnTypen[typ] || 0) + 1; }
      continue;
    }
    Z.gueltig++;
    if (e.korruption) Z.korruptAngenommen++;
    const v = res.angebot.vorlage;
    // unabhaengige Pruefung: der angebotene Plan besteht den Pruefer erneut
    if (!Pruefer.pruefeVorlage(v).ok) Z.ungueltigGespielt++;
    const folge = folgeVon(v), erster = Kanon.typenVon(v)[0];
    for (const typ of Kanon.typenVon(v)) typen[typ] = (typen[typ] || 0) + 1;
    folgen.set(folge, (folgen.get(folge) || 0) + 1);
    // eigene Rechnung gegen die Daten: Folge unter den letzten folge_zuletzt, Ort mit demselben ersten Beat unter den letzten ort_typ_zuletzt
    const WD = D.BRETT.werte.wiederholung;
    if (verlauf.slice(-WD.folge_zuletzt).some((x) => x.folge === folge)) wiederholungImVerlauf++;
    if (verlauf.slice(-WD.ort_typ_zuletzt).some((x) => x.hex === hex && x.erster === erster)) ortTypImVerlauf++;
    // das Abenteuer spielen (ein Wiedersehen mit dem frischen NSC)
    const wd = Pruefer.nscAlt(v);
    const parameter = wd ? { nsc_von: Wdh.kandidatenFrisch(g, v)[0] } : {};
    const o = Faden.abenteuerOeffnen(g, res.angebot.nr, parameter);
    if (!o.ok) { Z.ausnahmen++; continue; }
    if (wd) {
      Z.wiedersehen++;
      const sagte = Kanon.liste(Faden.zustandVon(g)).slice(-WD.nsc_zuletzt - 1, -1).some((x) => x.titel && x.name === o.faden.nsc.name);
      if (sagte) hauptfigurImVerlauf++;
    }
    Z.geoeffnet++; seitStart++;
    verlauf.push({ folge, hex, erster });
    beende(g, o.faden, r);
    if (Kanon.pruefe(Faden.zustandVon(g)).length) Z.kanonFehler++;
  }
  return { Z, promptZ, antwortZ, rechenMs, typen, folgen, ablehnTypen, rohWiederholt, rohGueltig, wiederholungImVerlauf, ortTypImVerlauf, hauptfigurImVerlauf };
}

function bericht(m) {
  const { Z } = m, WD = D.BRETT.werte.wiederholung;
  const abgelehnt = Object.values(Z.abgelehnt).reduce((s, x) => s + x, 0), wdhAbg = Object.entries(Z.abgelehnt).filter(([k]) => /^WIEDERHOLUNG/.test(k)).reduce((s, [, x]) => s + x, 0);
  const unlesbar = Object.entries(Z.abgelehnt).filter(([k]) => /^ANTWORT_/.test(k)).reduce((s, [, x]) => s + x, 0), lesbar = Z.plaene - unlesbar;
  const L = [];
  const p = (t) => { L.push(t); console.log(t); };
  p(`Messung Abenteuer-Plaene: ${Z.plaene} Plaene (Seed ${SEED}) durch die echte Kette (Prompt, Mock-Komposition, Lesen, Expander, Pruefer, Brett), das Spiel laeuft weiter (Kanon, Verlauf)`);
  p(`  Mock, nicht live gemessen: die Plaene kommen aus dem deterministischen Mock (abenteuer-mock.js), nicht aus einem Modell; er prueft die Kette, nicht die Qualitaet eines Modells.`);
  p('');
  p('1. Gueltigkeit (Kriterium 3)');
  p(`  gueltig angeboten ${Z.gueltig} (${pct(Z.gueltig, Z.plaene)}), abgelehnt ${abgelehnt} (${pct(abgelehnt, Z.plaene)}; davon vor dem Lesen verworfen ${unlesbar}: leer, zu gross, unlesbar)`);
  p(`  davon absichtlich ungueltige Mock-Plaene (Korruption, Anteil ${pct(Z.korrupt, Z.plaene)}): angenommen ${Z.korruptAngenommen} (soll 0 sein: eine Korruption, die das Brett durchlaesst, ist gueltig geblieben)`);
  p(`  Ablehnungen je Code: ${Object.entries(Z.abgelehnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pct(v, Z.plaene)})`).join(', ') || 'keine'}`);
  p(`  ungueltiger Plan gespielt (der angebotene Plan besteht den Pruefer nicht erneut): ${Z.ungueltigGespielt} (soll 0 sein); Kanon-Widersprueche im Lauf: ${Z.kanonFehler} (soll 0 sein); Ausnahmen: ${Z.ausnahmen}`);
  p('');
  p('2. Wiederholung (Kriterium 5; Regeln aus content/faeden/abenteuer-brett.json: ' + JSON.stringify(WD) + ')');
  p(`  ohne die Regeln (gueltige Plaene der Mock-Komposition): ${m.rohWiederholt} von ${m.rohGueltig} (${pct(m.rohWiederholt, m.rohGueltig)}) haetten die Typenfolge eines der letzten ${WD.folge_zuletzt} begonnenen Abenteuer`);
  p(`  durch das Brett: ${wdhAbg} Plaene wegen Wiederholung abgelehnt (${pct(wdhAbg, lesbar)} der lesbaren); in den ${Z.geoeffnet} begonnenen Abenteuern: gleiche Folge unter den letzten ${WD.folge_zuletzt} ${m.wiederholungImVerlauf}, gleicher Ort mit gleichem ersten Beat unter den letzten ${WD.ort_typ_zuletzt} ${m.ortTypImVerlauf}, Wiedersehen mit der Hauptfigur der letzten ${WD.nsc_zuletzt}: ${m.hauptfigurImVerlauf} (je soll 0 sein; eigene Rechnung, nicht der Pruefer)`);
  p('  NICHT GEMESSEN: "Folge gleich einem offenen Angebot" (die Angebote werden vor jedem Plan geleert, siehe messen(); die Regel hat ihren Test in test-abenteuer-kanon.js, nicht diese Messung)');
  p(`  ${m.folgen.size} verschiedene Typenfolgen in ${Z.gueltig} angebotenen Plaenen; die haeufigste: ${Array.from(m.folgen).sort((a, b) => b[1] - a[1]).slice(0, 1).map(([k, v]) => `${k} ${v} (${pct(v, Z.gueltig)})`)[0] || '–'}`);
  p('');
  p('3. Typverteilung der Beats in den angebotenen Plaenen (ohne Abschluss)');
  const sum = Object.values(m.typen).reduce((s, x) => s + x, 0);
  p('  ' + (Object.entries(m.typen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pct(v, sum)})`).join(', ') || 'keine'));
  p(`  Wiedersehen: ${Z.wiedersehen} Abenteuer (${pct(Z.wiedersehen, Z.geoeffnet)}) mit einem frischen NSC`);
  p('');
  p('4. Kosten (Kriterium 11)');
  const pz = m.promptZ, az = m.antwortZ;
  const mittel = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const tokIn = mittel(pz) / ZJT, tokAus = mittel(az) / ZJT, tokCall = tokIn + tokAus, geldCall = (tokCall * PREIS) / 1e6;
  p(`  GEMESSEN (Mock-Kette): Prompt ${fmt(mittel(pz))} Zeichen im Mittel (Median ${fmt(quant(pz, 0.5))}, p95 ${fmt(quant(pz, 0.95))}, max ${fmt(Math.max(...pz))}; Obergrenze ${AW.prompt_max_zeichen}), Antwort ${fmt(mittel(az))} Zeichen im Mittel (max ${fmt(Math.max(...az))}; Obergrenze ${AW.antwort_max_zeichen}); Rechenzeit der Kette ${fmt(mittel(m.rechenMs), 100)} ms je Plan (nicht die Dauer eines Modells)`);
  p(`  GESCHAETZT (Annahme ${fmt(ZJT)} Zeichen je Token): ${fmt(tokIn)} Token Eingabe + ${fmt(tokAus)} Token Ausgabe = ${fmt(tokCall)} Token je Aufruf`);
  p(`  GESCHAETZT (Annahme ${fmt(PREIS, 100)} USD je Mio. Token, Mischpreis aus SUND-03: 0,03 USD je Lage-Plan mit ca. 8 000 Token): ${fmt(geldCall, 10000)} USD je Aufruf (nur bei Claude; Ollama auf Sleipnir kostet kein Geld)`);
  const aufrufeJeAbenteuer = Z.gueltig ? Z.plaene / Z.gueltig : NaN, ohneKorruption = Z.gueltig ? (Z.plaene - Z.korrupt) / (Z.gueltig - Z.korruptAngenommen) : NaN;
  p(`  je Abenteuer: ${fmt(aufrufeJeAbenteuer, 100)} Aufrufe der Komposition je angebotenem Plan am Mock (${Z.plaene} Aufrufe, ${Z.gueltig} Angebote; jeder abgelehnte Plan hat einen Aufruf gekostet); ohne die absichtlichen Korruptionen des Mock (kuenstlich, ${pct(Z.korrupt, Z.plaene)}) ${fmt(ohneKorruption, 100)}: das ist der Anteil, den die Wiederholungsregeln und die Lage kosten. Wie oft ein echtes Modell ungueltige Plaene liefert, ist NICHT gemessen`);
  p(`  das sind ${fmt(aufrufeJeAbenteuer * tokCall)} Token und ${fmt(aufrufeJeAbenteuer * geldCall, 10000)} USD je angebotenem Abenteuer am Mock (${fmt(ohneKorruption * tokCall)} Token und ${fmt(ohneKorruption * geldCall, 10000)} USD ohne Korruption), geschaetzt; der Anschluss-Rueckfall braucht 0 Aufrufe, 0 Token, 0 USD`);
  const cd = AW.cooldown_grenzen, deckel = AW.deckel_je_sitzung;
  const aufrufeAbend = Math.min(deckel, 1 + Math.floor((GRENZEN - 1) / cd));
  p(`  je Abend (Annahme ${GRENZEN} Taetigkeitsgrenzen; Obergrenzen aus den Daten: Deckel ${deckel} Aufrufe je Sitzung, Cooldown ${cd} Grenzen): hoechstens ${aufrufeAbend} Aufrufe der Komposition = ${fmt(aufrufeAbend * tokCall)} Token = ${fmt(aufrufeAbend * geldCall, 10000)} USD (geschaetzt), am Mock davon ${fmt(aufrufeAbend / aufrufeJeAbenteuer, 10)} angebotene Abenteuer (ohne Korruption ${fmt(aufrufeAbend / ohneKorruption, 10)})`);
  p(`  Dauer: nicht live gemessen. Richtwert (Annahme, SUND-03: Median ${fmt(DAUER_CLAUDE_S, 10)} s je Claude-Aufruf des Lage-Plans): hoechstens ${fmt(aufrufeAbend * DAUER_CLAUDE_S, 10)} s je Abend, im Hintergrund (das Spiel wartet nie; Frist ${AW.timeout_s} s je Aufruf)`);
  p(`  dazu der Lage-Plan (nicht Teil dieser Messung): SUND-03 live: ca. 6 Plaene je Abend, ca. 0,17 USD`);
  p('');
  return { L, ok: Z.korruptAngenommen === 0 && Z.ungueltigGespielt === 0 && Z.kanonFehler === 0 && Z.ausnahmen === 0 && m.wiederholungImVerlauf === 0 && m.ortTypImVerlauf === 0 && m.hauptfigurImVerlauf === 0 };
}

function live() {
  console.log('5. Live-Lauf');
  if (!(flag('live') || process.env.LLM_LIVE === '1')) { console.log('  nicht live gemessen (weder --live noch LLM_LIVE=1): kein Aufruf eines echten Modells, kein Geld, kein Tunnel.'); return; }
  const lauf = (a) => spawnSync(process.execPath, ['tools/messe-abenteuer.js', ...a], { encoding: 'utf8', env: process.env, timeout: 15 * 60 * 1000 });
  for (const a of [['--live', '--n', '5'], ['--anbieter', 'ollama', '--n', '5']]) {
    const r = lauf(a);
    console.log(`  tools/messe-abenteuer.js ${a.join(' ')}:\n` + String(r.stdout || r.stderr || 'keine Ausgabe').split('\n').filter(Boolean).map((x) => '    ' + x).join('\n'));
  }
}

const m = messen();
const b = bericht(m);
live();
if (!b.ok) console.log('\nPFLICHTGROESSE VERLETZT (siehe oben: Werte, die 0 sein sollen)');
process.exit(b.ok ? 0 : 1);
