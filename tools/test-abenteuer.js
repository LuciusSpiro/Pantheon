'use strict';
// SUND-04b A2: Komposition von Abenteuern durch den Spielleiter und einstellbare Stufen (server/sim/abenteuer-spielleiter.js, abenteuer-prompt.js, abenteuer-mock.js, server/mission/stufen.js,
// Router und llm.js, Register-Aufraeumen in faden-daten.js). Kein Netz, kein Claude: Mock, Script und Fake-Transporte.
//   Daten und Katalog (aus den Daten abgeleitet) · Prompt (echter Prompt-Bau, keine Spielernamen, Titel und Anlass nie im naechsten Prompt) · Takt (Cooldown, Deckel, 3 Angebote, 1 laufendes, 3 Faeden) ·
//   200 Mock-Aufrufe (jede Antwort gueltig angeboten oder mit Code abgelehnt, kein Absturz) · Ausfall-Matrix (Fehler, Frist, Muell, zu gross, spaet, dispose: kein Angebot, Spiel laeuft weiter) · ohne Spielleiter und
//   ohne Schalter nichts · Register-Aufraeumen (bricht nie einen Faden oder ein Angebot) · Stufen (Standard, Datei, Umgebung, kaputte Datei, unbekannter Anbieter, Rueckfall, Eskalation, Text-Pool wie vorher) ·
//   Logbuch und Bericht · Speichern und Laden · Messwerkzeug.        node tools/test-abenteuer.js [begriff ...]   (npm run test:abenteuer)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const H = require('./transport-testhilfe.js');
const LLM = require('../server/mission/llm.js');
const Router = require('../server/mission/transport-router.js');
const Stufen = require('../server/mission/stufen.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const LS = require('../server/sim/lage-spielleiter.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const AM = require('../server/sim/abenteuer-mock.js');
const BP = require('../server/sim/faden-bauplan.js');
const Weltstand = require('../server/weltstand.js');
const Pool = require('../server/sim/texte-pool.js');
const Bericht = require('./regie-bericht.js');
const Regielog = require('../server/mission/regielog.js');

const { D, Faden } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const gewaehlt = (name) => !FILTER.length || FILTER.some((f) => name.toLowerCase().includes(f));
const frei = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AW = Object.fromEntries(Object.entries(require('../content/welt/abenteuer-werte.json').werte).map(([k, v]) => [k, v.wert]));
const LW = Object.fromEntries(Object.entries(require('../content/welt/lage-spielleiter-werte.json').werte).map(([k, v]) => [k, v.wert]));
const FW = D.WERTE;
const AN = { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' };   // SUND-04b C: der Rueckfall der Anschluss-Garantie bleibt hier aus: diese Tests pruefen nur die Komposition (der Rueckfall hat test-abenteuer-brett.js)
const NAME = 'ZEBRAKAI';

const spiel = (o) => X.spiel(Object.assign({ names: [NAME] }, o || {}, { env: Object.assign({}, AN, (o && o.env) || {}) }));
const ohneLage = (o) => X.spiel(Object.assign({ names: [NAME] }, o || {}));
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
const abLog = (g, ausgang) => logbuch(g).filter((e) => e.art === 'abenteuer_bauplan' && (ausgang === undefined || e.ausgang === ausgang));
const F = (g) => Faden.zustandVon(g);
const grenze = (g, art) => g.lageGrenze(art || 'andocken');
// Spiel mit eingesetztem Lage-Spielleiter (eigene LLM-Instanz: Mock, Script oder Fake-Transport), Anfragen und Prompts werden mitgeschrieben
function mitAbenteuer(t, llmOpts, werte, extra) {
  const llm = (extra && extra.llm) || LLM.create(Object.assign({ mode: 'mock' }, llmOpts || {}));
  llm.asks = []; llm.opts = [];
  const ask0 = llm.ask.bind(llm), esk0 = llm.eskaliere.bind(llm);
  llm.ask = (k, i, o) => { llm.asks.push({ kind: k, prompt: i && i.prompt, system: i && i.system, stufe: o && o.stufe }); return ask0(k, i, o); };
  llm.eskaliere = (k, i, o) => { llm.asks.push({ kind: k, eskaliert: true, prompt: i && i.prompt, stufe: o && o.stufe }); return esk0(k, i, o); };
  // der Lage-Plan startet an derselben Grenze (und die Komposition wartet dann auf ihn): ohne extra.lage bleibt er aus (Deckel 0), damit diese Tests nur die Komposition pruefen
  const sl = LS.create(t.g, { llm, werte: Object.assign({ deckel_je_sitzung: 0 }, (extra && extra.lageWerte) || {}), abenteuerWerte: werte || {} });
  t.g.lageSpielleiter = sl; t.g.lageSchalter = true;
  return { sl, ab: sl.abenteuer, llm, asks: () => llm.asks.filter((a) => a.kind === 'abenteuer') };
}
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
// eine Grenze ueber den ECHTEN Hook, danach so viele Schritte, dass der Aufruf angefragt, beantwortet und abgeholt ist
async function lauf(g, art) { grenze(g, art); await pumpen(g, 3); }

const b = (typ, o) => Object.assign({ typ }, o || {});
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Abenteuer', beats }, o || {});
const planN = (i) => plan([b('spontanhilfe'), b('abschluss')], { titel: 'Probe ' + i, anlass: 'Probeanlass Nummer ' + i + ' ohne Namen.' });
const PLAN_VOLL = plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('fracht'), b('enthuellung', { id: 'e' }), b('raumschlacht'), b('abschluss')], { anlass: 'Eine Frachtbitte, hinter der mehr steckt.' });
const scriptJson = (liste) => LLM.create({ mode: 'script', script: { abenteuer: liste } });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-abenteuer-'));
let dateiNr = 0;
const datei = (inhalt) => { const f = path.join(tmp, 'stufen' + (++dateiNr) + '.json'); fs.writeFileSync(f, typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt)); return f; };
const mitLive = async (fn) => { const alt = process.env.LLM_LIVE; process.env.LLM_LIVE = '1'; try { return await fn(); } finally { if (alt === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = alt; } };

// ======================================================================
section('Daten: Takt, Stufen-Datei, Katalog aus den Daten abgeleitet', () => {
  ok(AW.grenzen.every((g) => LW.grenzen.includes(g)) && AW.grenzen.length >= 1, 'Grenzen: eine Teilmenge der Grenzen der Lage (' + AW.grenzen.join(', ') + ')');
  ok(AW.timeout_s >= 30 && AW.timeout_s <= 300, 'Timeout: 30 bis 300 Sekunden Spielzeit (' + AW.timeout_s + ')');
  ok(AW.deckel_je_sitzung >= 1 && AW.deckel_je_sitzung <= 6 && AW.cooldown_grenzen >= 1 && AW.timeout_s > 0 && AW.min_budget > 0, 'Deckel, Cooldown, Timeout, Budget: sinnvolle Zahlen aus den Daten');
  ok(AW.antwort_max_zeichen <= FW.abenteuer.plan_max_zeichen && AW.prompt_max_zeichen > AW.antwort_max_zeichen, 'Antwortgrenze liegt unter der Plangroesse des Registers, der Prompt ueber der Antwort');
  ok(AW.mock.ungueltig_anteil > 0 && AW.mock.ungueltig_anteil < 1 && AW.mock.korruptionen.every((k) => typeof AM.KORRUPTION[k] === 'function') && Object.keys(AM.KORRUPTION).every((k) => AW.mock.korruptionen.includes(k)), 'Mock: jede Korruption der Daten hat eine Umsetzung und umgekehrt');
  const doc = JSON.parse(fs.readFileSync(Stufen.DATEI, 'utf8'));
  ok(Weltstand.fallbackValidate(doc, JSON.parse(fs.readFileSync(Stufen.SCHEMA, 'utf8'))).length === 0, 'content/spielleiter/stufen.json besteht sein Schema');
  ok(LLM.KINDS.includes('abenteuer') && ['bauplan', 'figuren_haupt', 'figuren_neben', 'geruechte_funk'].every((s) => Router.STUFEN.includes(s) && Router.ARTEN.includes(s)), 'llm.js kennt kind abenteuer, der Router die vier Stufen');
  const sys = fs.readFileSync(AP.SYSTEM_DATEI, 'utf8');
  ok(/abenteuer\.system\.md$/.test(LLM.systemPromptFile('abenteuer')) && /Der Katalog ist die Grenze/.test(sys) && /ausschließlich mit einem JSON-Objekt/.test(sys) && /keine Namen/.test(sys) && /Kein Game Over/.test(sys) && /nie Optionen/.test(sys), 'Systemprompt abenteuer.system.md: Katalog = Grenze, nur JSON, keine Namen, kein Game Over');
  ok(!/\{[a-z]/i.test(sys.replace(/`[^`]*`/g, '')) && !new RegExp(NAME, 'i').test(sys), 'Systemprompt ohne Platzhalter und Namen');
  // Katalog: unabhaengig aus den Daten gelesen (nicht aus abenteuer-prompt.js)
  const beats = JSON.parse(fs.readFileSync('content/faeden/beats.json', 'utf8')).beats;
  const bauplan = JSON.parse(fs.readFileSync('content/faeden/bauplan.json', 'utf8'));
  const werte = JSON.parse(fs.readFileSync('content/faeden/werte.json', 'utf8')).werte;
  const szenen = JSON.parse(fs.readFileSync('content/faeden/szenen-werte.json', 'utf8')).werte;
  const text = AP.katalogText();
  const planbar = Object.keys(beats).filter((t) => beats[t].bauplan && typeof beats[t].bauplan === 'object');
  const imText = text.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).split(/[ :]/)[0]);
  ok(planbar.length >= 9 && JSON.stringify(imText.sort()) === JSON.stringify(planbar.slice().sort()), `genau die ${planbar.length} planbaren Beat-Typen stehen im Katalog`);
  for (const t of planbar) {
    const bp = beats[t].bauplan;
    const zeile = text.split('\n').find((l) => l.startsWith('- ' + t));
    const erlaubtAlle = Object.values(bp.parameter || {}).flatMap((s) => (Array.isArray(s.erlaubt) ? s.erlaubt.filter((x) => x !== '$ort') : []));
    ok(erlaubtAlle.every((v) => zeile.includes(v)) && zeile.includes(beats[t].zweck) && zeile.includes('Start-Zustand ' + bp.start_status) && Object.keys(bp.parameter || {}).every((p) => zeile.includes(p + ' (Standard')), `${t}: Zweck, Parameter mit Standards und erlaubten Werten, Start-Zustand stehen im Katalog`);
    if (bp.aus && bp.aus.gelungen && bp.aus.gelungen.status) ok(bp.aus.gelungen.status.every((s) => zeile.includes(s)) && bp.aus.gescheitert.status.every((s) => zeile.includes(s)), `${t}: die Kandidaten-Zustaende der Ausgaenge stehen im Katalog`);
  }
  ok(Object.keys(bauplan.wahrheiten).every((k) => text.includes(k)) && werte.fluchtziele.wert.every((f) => text.includes(f)) && Object.keys(szenen.waren.wert).every((w) => text.includes(w)), 'Wahrheiten, Fluchtziele und Waren der Daten stehen im Katalog');
  ok(text.includes(`2 bis ${werte.beats_max.wert} Beats`) && text.includes(`${bauplan.werte.titel.wert.min} bis ${bauplan.werte.titel.wert.max} Zeichen`) && text.includes(`${bauplan.werte.anlass.wert.min} bis ${bauplan.werte.anlass.wert.max} Zeichen`) && text.includes(`hoechstens ${bauplan.werte.erfolg_max.wert} Typen`), 'Zahlen aus den Daten: Beats, Titel, Anlass, Erfolg');
  D.BEATS.nur_test_ohne_standards = { zweck: 'Probe ohne bauplan', baustein: 'x' };
  AP.katalogNeuLesen();
  const mitProbe = AP.katalogText();
  delete D.BEATS.nur_test_ohne_standards; AP.katalogNeuLesen();
  ok(!mitProbe.includes('nur_test_ohne_standards') && AP.katalogText() === text, 'ein Beat-Typ ohne Standards (bauplan) steht nie im Katalog');
  ok(AP.katalogText() === text && text.length < 9000, `der Katalog ist statisch und kurz (${text.length} Zeichen)`);
});

section('Prompt: echter Bau, keine Spielernamen, nie Titel oder Anlass', async () => {
  const t = spiel({ crew: 2, names: [NAME, 'Mireille_Kas'] });
  const g = t.g;
  for (let i = 0; i < 6; i++) g.step();
  // freier Text in der Chronik der Sim mit Spielernamen (roh eingetragen: der Filter des Ausschnitts muss greifen)
  g.weltsim.chronik = g.weltsim.chronik || [];
  g.weltsim.chronik.push({ t: 1, art: 'szene', ref: 'x', kurz: `${NAME} und Mireille_Kas retten einen Haendler bei Ostia` });
  const bau = AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [] });
  ok(bau.prompt && !bau.fehler && !new RegExp(`${NAME}|Mireille`, 'i').test(bau.prompt), 'AP.baue: kein Spielername im Prompt');
  ok(/Crew und Crew retten/.test(bau.prompt), 'die Chronik ist durch den Namensfilter gelaufen (Namen -> Crew)');
  ok(bau.zeichen <= AW.prompt_max_zeichen && bau.prompt.indexOf('<katalog>') === 0 && bau.prompt.indexOf('<kontext>') > bau.prompt.indexOf('</katalog>') && bau.prompt.endsWith('Nur das JSON-Objekt.'), `Reihenfolge Katalog > Kontext > Aufruf, unter der Obergrenze (${bau.zeichen} Zeichen)`);
  // der ECHTE Weg: Grenze -> Hook -> Lage-Spielleiter -> Aufruf; der Prompt, der den Transport erreicht, wird durchsucht
  const m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ json: plan([b('spontanhilfe'), b('abschluss')], { titel: NAME + ' Abenteuer', anlass: `Die Crew ${NAME} hilft.` }) }] } });
  await lauf(g);
  const a1 = m.asks();
  ok(a1.length === 1 && a1[0].system === AP.SYSTEM_DATEI && a1[0].stufe === 'bauplan', 'ein eigener Aufruf kind abenteuer, Systemprompt abenteuer.system.md, Stufe bauplan');
  ok(!new RegExp(`${NAME}|Mireille`, 'i').test(a1[0].prompt) && /Crew und Crew retten/.test(a1[0].prompt), 'der Prompt, der den Transport erreicht, enthaelt keinen Spielernamen');
  ok(F(g).abenteuerAngebote.length === 1 && F(g).abenteuerAngebote[0].vorlage.titel.includes(NAME), 'der Plan mit Spielernamen im Titel wurde angeboten (der Pruefer erkennt Namen nicht)');
  // ein zweiter Aufruf: Titel und Anlass des ersten stehen NICHT im Prompt, nur die Typenfolge
  for (let i = 0; i < AW.cooldown_grenzen; i++) grenze(g);
  await pumpen(g, 3);
  const a2 = m.asks();
  ok(a2.length === 2 && !new RegExp(NAME, 'i').test(a2[1].prompt) && !/Abenteuer"|hilft/.test(a2[1].prompt.split('<kontext>')[1]), 'zweiter Aufruf: Titel und Anlass des ersten nie im Prompt');
  const k2 = JSON.parse(a2[1].prompt.split('<kontext>\n')[1].split('\n</kontext>')[0]);
  ok(JSON.stringify(k2.letzte_abenteuer) === JSON.stringify([['spontanhilfe']]) && JSON.stringify(k2.faeden.abenteuer_angebote) === JSON.stringify([['spontanhilfe']]), 'im Kontext steht nur die Typenfolge der letzten und der offenen Abenteuer');
  ok(k2.crew && !('anzahl' in k2.crew) && k2.crew.rang && !JSON.stringify(k2).includes('name'), 'die Crew steht nur als Rang, Stufe und Ort im Kontext');
  // Zufallsnamen aus dem Spiel selbst (Faden-NSC) gelangen nie in den Kontext
  const o = Faden.abenteuerAnbieten(g, planN(77), { hex: '0305' });
  const r = o.ok ? Faden.abenteuerOeffnen(g, o.angebot.nr) : { ok: false };
  const prompt3 = AP.baue(g, { nr: 3, grenze: 'andocken', hex: '0305', letzte: [], werte: AW }).prompt;
  ok(r.ok && !prompt3.includes(r.faden.nsc.name) && !prompt3.includes(r.faden.nsc.name.split(' ')[0]), 'der Name des NSC eines laufenden Abenteuers steht nicht im Prompt');
  const kontextVon = (p) => JSON.parse(p.split('<kontext>\n')[1].split('\n</kontext>')[0]);
  const k3 = kontextVon(prompt3);
  ok(k3.faeden.laufende_abenteuer === 1 && k3.faeden.aktiv.length === 1 && k3.faeden.aktiv[0].v === 'abenteuer' && JSON.stringify(k3.faeden.aktiv[0].typen) === '["spontanhilfe"]' && k3.faeden.aktiv[0].ph === 'wartet', 'der Kontext nennt das laufende Abenteuer (nur Typenfolge und Phase, keine Id, keinen Titel)');
  r.faden.phase = 'abgeschlossen';
  const k4 = kontextVon(AP.baue(g, { nr: 4, grenze: 'andocken', hex: '0305', letzte: [], werte: AW }).prompt);
  ok(k4.faeden.aktiv.length === 0 && k4.faeden.laufende_abenteuer === 0, 'ein abgeschlossener Faden steht nicht als aktiv im Kontext');
  r.faden.phase = 'wartet';
  // Kuerzung: Chronik, Wendepunkte und Gesamtgroesse stehen unter den Zahlen der Daten
  for (let i = 0; i < 20; i++) g.weltsim.chronik.push({ t: 2 + i, art: 'szene', ref: 'x' + i, kurz: 'Ereignis Nummer ' + i });
  const kc = kontextVon(AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], werte: Object.assign({}, AW, { chronik_zeilen: 3 }) }).prompt);
  ok(kc.chronik.length === 3 && /Nummer 19/.test(kc.chronik[2]), 'chronik_zeilen (Daten): nur die letzten Zeilen der Chronik');
  for (let i = 0; i < 600 && AP.kontextVon(g, AW, [], 0).wendepunkte.length < 3; i++) Kriegslage.tick(g, 'test');
  const w0 = AP.kontextVon(g, AW, [], 0).wendepunkte.length, w2 = AP.kontextVon(g, Object.assign({}, AW, { wendepunkte_max: 2 }), [], 0).wendepunkte.length;
  ok(w0 >= 3 && w2 === 2, `wendepunkte_max (Daten): von ${w0} Wendepunkten der Sim bleiben 2`);
  const voll = AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], werte: AW });
  const klein = AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], werte: Object.assign({}, AW, { prompt_max_zeichen: voll.zeichen - 80 }) });
  ok(klein.prompt && klein.zeichen <= voll.zeichen - 80 && klein.zeichen < voll.zeichen, `Obergrenze des Prompts: der Kontext wird gekuerzt (${voll.zeichen} -> ${klein.zeichen} Zeichen)`);
  ok(AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], werte: Object.assign({}, AW, { prompt_max_zeichen: AP.katalogText().length }) }).fehler, 'passt auch der gekuerzte Kontext nicht, gibt es einen Fehler statt eines Prompts');
  const lw = ['a', 'b', 'c', 'd'].map((x, i) => ({ nr: i, typen: [x] }));
  ok(JSON.stringify(kontextVon(AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: lw, werte: Object.assign({}, AW, { letzte_abenteuer: 2 }) }).prompt).letzte_abenteuer) === '[["c"],["d"]]', 'letzte_abenteuer (Daten): nur die letzten Typenfolgen');
  // Antwort lesen: das Objekt mit Bauplan-Schluesseln gilt, ein Objekt davor stoert nicht
  const js = JSON.stringify(planN(3));
  ok(AP.bauplanAusText('Notiz {"a": 1} dazu: ' + js).plan.titel === 'Probe 3' && AP.bauplanAusText('x').fehler && AP.bauplanAusText(null).fehler, 'bauplanAusText: erkennt das Bauplan-Objekt nach einem anderen Objekt, Muell ergibt einen Fehler');
  const LP = require('../server/sim/lage-prompt.js');
  ok(JSON.stringify(LP.planAusText('Notiz {"a": 1} dazu: {"befehle": [], "begruendung": "ruhig"}').plan) === '{"befehle":[],"begruendung":"ruhig"}' && LP.planAusText('{"a": 1}').plan.a === 1, 'planAusText (Lage, gemeinsame Lesart): das Objekt mit Plan-Schluesseln gilt, sonst das erste lesbare');
  // llm.js: Mock und Script kennen kind abenteuer
  const inp = { prompt: voll.prompt };
  const rm = await LLM.create({ mode: 'mock' }).ask('abenteuer', inp), rs = await LLM.create({ mode: 'script' }).ask('abenteuer', inp);
  ok(rm.text === AM.planText(inp) && rm.source === 'mock' && rm.tokens === 0 && rs.text === rm.text, 'llm.js: mock und script (leere Liste) liefern den Mock-Bauplan fuer kind abenteuer');
  ok(AM.planText(inp) === AM.planText({ prompt: voll.prompt }) && AM.planText(inp) !== AM.planText({ prompt: voll.prompt.replace('"nr":1', '"nr":2') }), 'der Mock ist deterministisch (gleicher Prompt, gleiche Antwort) und haengt vom Aufruf ab');
});

section('Takt: Cooldown, Deckel, 3 Angebote, 1 laufendes, 3 Faeden', async () => {
  // Cooldown: nur Muell als Antwort, damit keine Angebote die Rechnung stoeren; die Starts liegen bei Grenze 1, 1+c, 1+2c ... (aus den Daten gerechnet)
  const c = AW.cooldown_grenzen;
  const t1 = spiel(), m1 = mitAbenteuer(t1, { mode: 'script', script: { abenteuer: Array.from({ length: 30 }, () => ({ text: 'kein json' })) } }, { deckel_je_sitzung: 99 });
  const starts = [];
  for (let k = 1; k <= 4 * c + 2; k++) { const vorher = m1.asks().length; await lauf(t1.g); if (m1.asks().length > vorher) starts.push(k); }
  ok(JSON.stringify(starts) === JSON.stringify([1, 1 + c, 1 + 2 * c, 1 + 3 * c, 1 + 4 * c]), `Cooldown ${c}: Starts bei Grenze ${starts.join(', ')} (Soll 1, ${1 + c}, ${1 + 2 * c}, ...)`);
  ok(m1.ab.zaehler.uebersprungen.cooldown === 4 * c + 2 - 5, 'jede Grenze dazwischen ist als cooldown uebersprungen gezaehlt');
  ok(logbuch(t1.g).filter((e) => e.art === 'abenteuer_bauplan' && e.grund === 'cooldown').length === 5, 'im Logbuch steht ein Cooldown nur einmal je Folge (fuenf Folgen, keine Flut)');
  ok(m1.ab.beiGrenze('notruf') === null && m1.ab.zaehler.uebersprungen.cooldown === 4 * c + 2 - 5, 'eine Grenze, die nicht in den Daten steht, loest nichts aus und zaehlt nicht');
  // Deckel je Sitzung
  const t2 = spiel(), m2 = mitAbenteuer(t2, { mode: 'script', script: { abenteuer: Array.from({ length: 30 }, () => ({ text: 'kein json' })) } }, { deckel_je_sitzung: 3, cooldown_grenzen: 1 });
  for (let k = 0; k < 10; k++) await lauf(t2.g);
  ok(m2.asks().length === 3 && m2.ab.aufrufe === 3 && m2.ab.zaehler.uebersprungen.deckel === 7, 'Deckel 3: genau drei Aufrufe in zehn Grenzen, sieben als deckel uebersprungen');
  // Obergrenze 3 offene Angebote
  const t3 = spiel(), m3 = mitAbenteuer(t3, { mode: 'script', script: { abenteuer: [1, 2, 3, 4, 5, 6].map((i) => ({ json: planN(i) })) } }, { deckel_je_sitzung: 99, cooldown_grenzen: 1 });
  for (let k = 0; k < 9; k++) await lauf(t3.g);
  ok(F(t3.g).abenteuerAngebote.every((a) => a.hex === '0305'), 'das Angebot liegt am Ort der Crew (Hex 0305)');
  ok(F(t3.g).abenteuerAngebote.length === FW.abenteuer.angebote_max && m3.asks().length === FW.abenteuer.angebote_max, `hoechstens ${FW.abenteuer.angebote_max} offene Angebote: drei Aufrufe, danach keiner mehr (${m3.asks().length})`);
  ok(m3.ab.zaehler.uebersprungen.angebote_voll === 9 - 3, 'die uebrigen Grenzen sind als angebote_voll uebersprungen');
  ok(!m3.ab.erzwingen().gestartet && m3.ab.erzwingen().grund === 'angebote_voll', 'auch das Debug-Kommando (erzwingen) beachtet die Obergrenze der Angebote');
  // 1 laufendes Abenteuer und 3 aktive Faeden
  const g = t3.g, a = F(g).abenteuerAngebote;
  const r1 = Faden.abenteuerOeffnen(g, a[0].nr), r2 = Faden.abenteuerOeffnen(g, a[0] ? F(g).abenteuerAngebote[0].nr : 0);
  ok(r1.ok && !r2.ok && /^ABENTEUER_LAUFEND/.test(r2.grund), 'ein zweites Abenteuer laesst sich nicht oeffnen: ' + r2.grund);
  const f1 = X.oeffne(g), f2 = X.oeffne(g), f3 = X.oeffne(g);
  ok(f1 && f2 && !f3, 'neben dem Abenteuer zwei weitere Faeden, der dritte (4. aktive) scheitert an der Obergrenze');
  const r3 = Faden.abenteuerOeffnen(g, F(g).abenteuerAngebote[0].nr);
  ok(!r3.ok && /^OBERGRENZE/.test(r3.grund), `${FW.aktiv_max} aktive Faeden: ${r3.grund}`);
  // Verfall der Angebote gibt den Platz frei: nach der Frist beginnt der Spielleiter wieder
  for (let k = 0; k < FW.abenteuer.angebot_gilt_taetigkeiten + 1; k++) grenze(g);
  ok(F(g).abenteuerAngebote.length === 0, 'die Angebote sind nach ' + FW.abenteuer.angebot_gilt_taetigkeiten + ' Taetigkeiten verfallen');
  const vorher = m3.asks().length;
  await lauf(g); await lauf(g);
  ok(m3.asks().length > vorher, 'danach darf wieder komponiert werden');
});

section('Mock: 200 Aufrufe, jede Antwort gueltig angeboten oder mit Code abgelehnt', async () => {
  const t = spiel(), m = mitAbenteuer(t, {}, { deckel_je_sitzung: 1e9, cooldown_grenzen: 0 });
  const g = t.g;
  for (let i = 0; i < 6; i++) g.step();
  // erwarteter Code je Korruption: aus der Regel abgeleitet (nicht aus dem Produktivcode), erster Code der Ablehnung
  const CODE = { typ_unbekannt: ['TYP_UNBEKANNT'], abschluss_fehlt: ['ABSCHLUSS_FEHLT', 'WEITER_UNGUELTIG'], abschluss_nicht_letzt: ['ABSCHLUSS_NICHT_LETZT'], parameter_verboten: ['PARAMETER'], verzweigung_rueckwaerts: ['WEITER_UNGUELTIG'],
    optionen_bei_gefahr: ['OPTION_BEI_GEFAHR'], enthuellung_ohne_hinweis: ['HINWEIS_FEHLT'], proto_schluessel: ['FORM', 'ABENTEUER_FORM'], zu_gross: ['ANTWORT_ZU_GROSS'], kein_json: ['ANTWORT_UNLESBAR'], abgeschnitten: ['ANTWORT_UNLESBAR'],
    anlass_platzhalter: ['BAUPLAN_TEXT'], titel_zu_kurz: ['FORM'], format_falsch: ['FORM'] };
  let gueltig = 0, abgelehnt = 0, falsch = 0, ausfall = 0, korrupt = 0;
  const abw = [];
  const gesehen = {}, typenFolgen = [];
  for (let i = 0; i < 200; i++) {
    F(g).abenteuerAngebote.length = 0;   // die Angebote verfallen (Obergrenze steht hier nicht zur Pruefung)
    const r = m.ab.erzwingen();
    if (!r.gestartet) { falsch++; continue; }
    await pumpen(g, 3);
    const k = m.asks().length - 1, erw = AM.erzeuge({ prompt: m.asks()[k].prompt }).korruption;   // was der Mock fuer genau diesen Prompt bauen wollte
    const letzter = logbuch(g).filter((x) => x.art === 'abenteuer_bauplan' && x.plan && x.plan.nr === m.ab.aufrufe && x.ausgang !== 'uebersprungen').pop();
    if (!letzter) { falsch++; continue; }
    if (letzter.ausgang === 'gueltig') { gueltig++; if (erw) { falsch++; abw.push(['gueltig trotz ' + erw, i]); } if (F(g).abenteuerAngebote.length !== 1) { falsch++; abw.push(['Angebote ' + F(g).abenteuerAngebote.length, i]); } else typenFolgen.push(JSON.stringify(AP.typenVon(F(g).abenteuerAngebote[0].vorlage))); }
    else if (letzter.ausgang === 'abgelehnt') { abgelehnt++; korrupt++; gesehen[letzter.grund] = (gesehen[letzter.grund] || 0) + 1; if (!erw || !CODE[erw].includes(letzter.grund) || F(g).abenteuerAngebote.length) { falsch++; abw.push([String(erw) + ' -> ' + letzter.grund, i]); } }
    else { ausfall++; falsch++; }
  }
  ok(gueltig + abgelehnt === 200 && falsch === 0 && ausfall === 0, `200 Aufrufe: ${gueltig} gueltig angeboten, ${abgelehnt} mit Code abgelehnt, ${falsch} Abweichungen von der Erwartung ${JSON.stringify(abw.slice(0, 4))}, ${ausfall} Ausfaelle`);
  ok(g.errors === 0, 'kein Serverfehler (g.errors 0)');
  ok(abgelehnt >= 200 * AW.mock.ungueltig_anteil * 0.4 && abgelehnt <= 200 * AW.mock.ungueltig_anteil * 1.8, `der Mock lehnt etwa ${Math.round(AW.mock.ungueltig_anteil * 100)} % ab (${abgelehnt} von 200: ${JSON.stringify(gesehen)})`);
  ok(Object.keys(gesehen).length >= 5 && new Set(typenFolgen).size >= 10, `viele verschiedene Codes (${Object.keys(gesehen).length}) und Typenfolgen (${new Set(typenFolgen).size}) kommen vor`);
  const z = m.ab.zaehler;
  ok(m.ab.aufrufe === 200 && z.gueltig === gueltig && Object.values(z.abgelehnt).reduce((s, x) => s + x, 0) === abgelehnt && z.ausfall === 0, 'die Zaehler des Spielleiters stimmen (200 Aufrufe, je Ausgang gezaehlt)');
  ok(Object.keys(z.abgelehnt).every((c) => /^[A-Z_]+$/.test(c)), 'jede Ablehnung traegt einen Code');
  ok(g.weltsim && D.abenteuerAnzahl() < 50, 'das Register waechst nicht mit den Angeboten (nur geoeffnete Abenteuer stehen darin)');
});

section('Ausfall-Matrix: Fehler, Frist, Muell, zu gross, spaet, dispose', async () => {
  const faelle = [
    ['Timeout des Transports', { error: 'timeout' }, 'ausfall', 'ETIMEDOUT'],
    ['CLI fehlt', { error: 'enoent' }, 'ausfall', 'ENOENT'],
    ['Exit 1', { error: 'exit' }, 'ausfall', 'EXIT'],
    ['429', { error: '429' }, 'ausfall', 'RATE_LIMIT'],
    ['Muell (kein JSON)', { text: 'Gerne! Hier ist meine Idee: ein Haendler.' }, 'abgelehnt', 'ANTWORT_UNLESBAR'],
    ['leere Antwort', { text: '   ' }, 'abgelehnt', 'ANTWORT_LEER'],
    ['abgeschnittenes JSON', { text: '{"format": "faden-bauplan/1", "titel": "Probe", "beats": [{"typ": "bitte"' }, 'abgelehnt', 'ANTWORT_UNLESBAR'],
    ['zu grosse Antwort', { text: JSON.stringify(planN(1)) + ' '.repeat(AW.antwort_max_zeichen) }, 'abgelehnt', 'ANTWORT_ZU_GROSS'],
    ['falsches Objekt', { json: { befehle: [], begruendung: 'Plan der Lage statt Bauplan' } }, 'abgelehnt', 'FORM'],
    ['unbekannter Typ', { json: plan([b('teleport'), b('abschluss')]) }, 'abgelehnt', 'TYP_UNBEKANNT'],
  ];
  for (const [name, eintrag, ausgang, code] of faelle) {
    const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [eintrag] } });
    const lageVorher = logbuch(t.g).length;
    await lauf(t.g);
    const e = abLog(t.g).filter((x) => x.ausgang !== 'uebersprungen');
    ok(e.length === 1 && e[0].ausgang === ausgang && e[0].grund === code && F(t.g).abenteuerAngebote.length === 0, `${name}: ${ausgang} ${code}, kein Angebot, ein Eintrag im Logbuch`);
    ok(t.g.errors === 0 && !logbuch(t.g).some((x) => x.art === 'lage_befehl' && x.ausgang === 'rueckfall') && m.ab.zustand === 'idle', `${name}: kein Serverfehler, kein Rueckfall der Standard-KI, der Spielleiter ist wieder frei`);
    await pumpen(t.g, 30);
    ok(t.g.errors === 0, `${name}: das Spiel laeuft weiter`);
    void lageVorher;
  }
  // CLI fehlt: der Transport ist fuer die Sitzung aus, jede weitere Grenze wird uebersprungen (keine Flut von Versuchen)
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ error: 'enoent' }] } }, { cooldown_grenzen: 1 });
    await lauf(t.g); await lauf(t.g); await lauf(t.g);
    ok(m.asks().length === 1 && m.ab.zaehler.uebersprungen.transport_aus === 2 && abLog(t.g, 'ausfall').length === 1, 'ENOENT: nur ein Versuch, danach transport_aus'); }
  // Frist in Spielzeit: ein haengender Aufruf wird zum Ausfall, eine spaete Antwort wird verworfen (kein Angebot)
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ hold: true, json: planN(5), tokens: 321 }] } });
    grenze(t.g); await pumpen(t.g, 3);
    ok(m.ab.zustand === 'laeuft' && m.llm.pending() === 1, 'der Aufruf haengt (Zustand laeuft)');
    t.g.time += AW.timeout_s + 5; await pumpen(t.g, 2);
    const e = abLog(t.g, 'ausfall');
    ok(e.length === 1 && e[0].grund === 'ETIMEDOUT' && m.ab.zustand === 'idle', 'Frist: ausfall ETIMEDOUT, der Spielleiter ist frei');
    m.llm.release(); await pumpen(t.g, 2);
    const v = abLog(t.g, 'verspaetet');
    ok(v.length === 1 && v[0].tokens === 321 && F(t.g).abenteuerAngebote.length === 0 && abLog(t.g, 'gueltig').length === 0, 'spaete Antwort: verworfen, nur die Tokens stehen im Logbuch, kein Angebot'); }
  // ein Job zugleich: solange ein Aufruf in der Luft ist, startet keine weitere Grenze einen zweiten
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ hold: true, json: planN(5) }] } }, { cooldown_grenzen: 1 });
    await lauf(t.g); await lauf(t.g); await lauf(t.g);
    ok(m.asks().length === 1 && m.ab.zaehler.uebersprungen.beschaeftigt === 2 && m.ab.zustand === 'laeuft', 'ein Aufruf in der Luft: weitere Grenzen starten keinen zweiten (beschaeftigt)');
    const dbg = m.ab.erzwingen();
    ok(!dbg.gestartet && dbg.grund === 'beschaeftigt' && m.asks().length === 1, 'auch das Debug-Kommando startet keinen zweiten Aufruf');
    t.g.time += AW.timeout_s; await pumpen(t.g, 1);
    ok(m.ab.zustand === 'laeuft' && abLog(t.g, 'ausfall').length === 0, 'Frist: genau timeout_s Spielzeit sind noch keine Zeitueberschreitung'); }
  // Abbruch: Frist und dispose beenden den Transport (AbortSignal), eine abgebrochene Antwort ist keine spaete Antwort
  for (const wie of ['frist', 'dispose']) {
    await mitLive(async () => {
      const gesehen = { timeoutMs: null, signal: false, abort: false };
      const haengt = { name: 'haengt', call: (text, co) => new Promise((res, rej) => { const meins = co.kind === 'abenteuer'; if (meins) { gesehen.timeoutMs = co.timeoutMs; gesehen.signal = !!co.signal; } co.signal.addEventListener('abort', () => { if (meins) gesehen.abort = true; rej(Object.assign(new Error('abgebrochen'), { code: 'ABORTED' })); }); }) };   // nur der Aufruf der Komposition zaehlt (der Plan der Lage haengt ebenfalls und wird von der Lage selbst abgebrochen)
      const t = spiel(), m = mitAbenteuer(t, null, {}, { llm: LLM.create({ mode: 'live', transport: haengt }) });
      grenze(t.g); await pumpen(t.g, 3);
      if (wie === 'frist') { t.g.time += AW.timeout_s + 5; await pumpen(t.g, 3); } else { m.sl.dispose(); await pumpen(t.g, 3); }
      ok(gesehen.timeoutMs === 1000 * AW.timeout_s && gesehen.signal && gesehen.abort, `${wie}: der Transport bekommt Frist (${gesehen.timeoutMs} ms) und Signal und wird abgebrochen`);
      ok(abLog(t.g, 'verspaetet').length === 0 && abLog(t.g, 'ausfall').length === (wie === 'frist' ? 1 : 0) && t.g.errors === 0, `${wie}: die abgebrochene Antwort zaehlt nicht als spaete Antwort`);
    });
  }
  // Prompt zu gross: Ausfall mit klarer Meldung, kein Aufruf
  { const t = spiel(), m = mitAbenteuer(t, {}, { prompt_max_zeichen: 200 });
    await lauf(t.g);
    const e = abLog(t.g, 'ausfall');
    ok(m.asks().length === 0 && e.length === 1 && /Prompt zu gross/.test(e[0].fehler[0]) && F(t.g).abenteuerAngebote.length === 0 && m.ab.zustand === 'idle', 'Prompt ueber der Obergrenze: Ausfall, kein Aufruf, kein Angebot'); }
  // Antwortgroesse: genau die Grenze ist erlaubt, ein Zeichen mehr nicht
  { const js = JSON.stringify(planN(8));
    const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ text: js + ' '.repeat(AW.antwort_max_zeichen - js.length) }, { text: js + ' '.repeat(AW.antwort_max_zeichen - js.length + 1) }] } }, { cooldown_grenzen: 1 });
    await lauf(t.g); await lauf(t.g);
    ok(abLog(t.g, 'gueltig').length === 1 && abLog(t.g, 'abgelehnt').length === 1 && abLog(t.g, 'abgelehnt')[0].grund === 'ANTWORT_ZU_GROSS' && m.ab.zaehler.gueltig === 1, `Antwort mit genau ${AW.antwort_max_zeichen} Zeichen gilt, eine mehr ist zu gross`); }
  // Ausnahmen in den Haken des Lage-Spielleiters erreichen das Spiel nie
  { const t = spiel(), m = mitAbenteuer(t, {}, {}, { lageWerte: { deckel_je_sitzung: LW.deckel_je_sitzung } });
    m.ab.beiGrenze = () => { throw new Error('Haken kaputt'); }; m.ab.update = () => { throw new Error('Haken kaputt'); };
    let wirft = false, r;
    try { r = m.sl.beiGrenze('andocken'); m.sl.update(0.1); } catch (e) { wirft = true; }
    ok(!wirft && r && r.gestartet === true && t.g.errors === 2, 'eine Ausnahme der Komposition erreicht den Aufrufer nie (gezaehlt, der Plan der Lage laeuft weiter)'); }
  // Debug-Kommando lage abenteuer
  { const t = spiel(), m = mitAbenteuer(t, {});
    ok(/^Abenteuer-Komposition: Zustand idle, Aufrufe 0\/4/.test(m.sl.debug(['abenteuer'])) && /angefragt/.test(m.sl.debug(['abenteuer', 'plan'])) && m.ab.zustand === 'angefragt' && /abenteuer \[status \| plan\]/.test(m.sl.debug(['x'])), 'lage abenteuer status | plan'); }
  // eine spaete Antwort eines frueheren Aufrufs vollendet nie den spaeteren (Token): Aufruf 1 laeuft in die Frist, Aufruf 2 laeuft, die Antwort von 1 kommt zuerst
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ hold: true, json: planN(1), tokens: 11 }, { hold: true, json: planN(2), tokens: 22 }] } }, { cooldown_grenzen: 1 });
    await lauf(t.g);
    t.g.time += AW.timeout_s + 5; await pumpen(t.g, 2);
    await lauf(t.g);
    ok(m.ab.zustand === 'laeuft' && m.llm.pending() === 2 && abLog(t.g, 'ausfall').length === 1, 'zweiter Aufruf laeuft, der erste ist in die Frist gelaufen');
    m.llm.release(1); await pumpen(t.g, 2);
    ok(m.ab.zustand === 'laeuft' && F(t.g).abenteuerAngebote.length === 0 && m.ab.zaehler.verspaetet === 1 && abLog(t.g, 'verspaetet').length === 1, 'die Antwort des ersten Aufrufs ist verspaetet: verworfen, gezaehlt, der zweite laeuft weiter');
    m.llm.release(1); await pumpen(t.g, 2);
    ok(m.ab.zustand === 'idle' && F(t.g).abenteuerAngebote.length === 1 && F(t.g).abenteuerAngebote[0].vorlage.titel === 'Probe 2', 'die Antwort des zweiten Aufrufs wird angenommen (Angebot aus Plan 2)'); }
  // ein Abbruch (ABORTED) ohne eigenen Abbruch ist ein Ausfall im Logbuch und wird nie eskaliert
  await mitLive(async () => {
    const claudeGerufen = [];
    const rt = Router.routeTransport({ bauplan: { anbieter: 'ollama', eskalation: true } }, { transports: { claude: { name: 'claude', async call(text, co) { if (co.kind === 'lage') return { text: '{"befehle": [], "begruendung": "ruhig"}', usage: { input: 1, output: 1 }, sec: 0.1 }; claudeGerufen.push(1); return { text: '{}', usage: { input: 1, output: 1 }, sec: 0.1 }; } }, ollama: { name: 'ollama', async call() { throw Object.assign(new Error('Ollama: Anfrage abgebrochen'), { code: 'ABORTED' }); } } } });
    const t = spiel(), m = mitAbenteuer(t, null, {}, { llm: LLM.create({ mode: 'live', transport: rt }) });
    await lauf(t.g);
    const e = abLog(t.g, 'ausfall');
    ok(e.length === 1 && e[0].grund === 'ABORTED' && claudeGerufen.length === 0 && m.ab.zustand === 'idle' && m.ab.zaehler.ausfall === 1, 'ein Abbruch des Transports: Ausfall ABORTED im Logbuch, Claude nicht gefragt');
  });
  // dispose mit Aufruf in der Luft: nichts mehr, keine Folgen, kein Rueckfall der Lage durch die Komposition
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ hold: true, json: planN(6) }] } });
    grenze(t.g); await pumpen(t.g, 3);
    const vorher = abLog(t.g).length;
    m.sl.dispose(); m.llm.release(); await pumpen(t.g, 3);
    ok(m.ab.disposed && abLog(t.g).length === vorher && F(t.g).abenteuerAngebote.length === 0 && t.g.errors === 0, 'dispose: die Antwort kommt nie an, kein Eintrag, kein Angebot');
    ok(m.ab.beiGrenze('andocken') === null && !m.ab.erzwingen().gestartet, 'nach dispose tut der Spielleiter nichts mehr'); }
  // Modus off: kein Aufruf, kein Eintrag
  { const t = spiel({ env: { SPIELLEITER_LLM: 'off' } }), m = mitAbenteuer(t, { mode: 'off' });
    await lauf(t.g); await lauf(t.g);
    ok(m.asks().length === 0 && abLog(t.g).length === 0, 'Modus off: kein Aufruf und kein Abenteuer-Eintrag'); }
  // Aufruf ohne Ort der Crew (kein spielbarer Sektor): kein Aufruf
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'mock' });
    m.ab.crewHex = () => null;   // die Crew steht in keinem spielbaren Sektor
    await lauf(t.g);
    ok(m.asks().length === 0 && m.ab.zaehler.uebersprungen.kein_ort === 1, 'ohne spielbaren Ort kein Aufruf (kein_ort)'); }
  // Die Antwort kommt asynchron: die Grenze merkt nur vor, gebaut und gefragt wird im naechsten update
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'mock' });
    const r = grenze(t.g);
    ok(m.ab.zustand === 'angefragt' && m.asks().length === 0 && F(t.g).abenteuerAngebote.length === 0 && r !== undefined, 'Grenze: nur vorgemerkt (Zustand angefragt), noch kein Aufruf');
    t.g.step();
    ok(m.ab.zustand === 'laeuft' && m.asks().length === 1 && F(t.g).abenteuerAngebote.length === 0, 'update: der Aufruf geht raus, die Antwort ist noch nicht da');
    await frei(); t.g.step();
    ok(m.ab.zustand === 'idle', 'naechstes update: Antwort abgeholt'); }
});

section('ohne Spielleiter und ohne Schalter: Faeden und Abenteuer bleiben stehen, nichts bricht', async () => {
  // FAEDEN=1, kein Lage-Spielleiter: ein Abenteuer von Hand, dazu viele Grenzen und Schritte
  const t = ohneLage(), g = t.g;
  const o = Faden.abenteuerAnbieten(g, PLAN_VOLL, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, o.angebot.nr);
  const o2 = Faden.abenteuerAnbieten(g, planN(11), { hex: '0305' });
  for (let k = 0; k < 30; k++) { grenze(g, ['szene_ende', 'andocken', 'absicht'][k % 3]); g.step(); }
  await pumpen(g, 5);
  const f = F(g).liste.find((x) => x.plan);
  ok(r.ok && o2.ok && f && f.phase === 'wartet' && f.beat === 0 && g.errors === 0, 'Abenteuer steht (wartet, Beat 0), kein Fehler: ohne Spielleiter laeuft die Frist nicht ab');
  ok(F(g).abenteuerAngebote.length === 0, 'das Angebot ist verfallen (Frist laeuft ueber die Taetigkeiten, nicht ueber den Spielleiter)');
  ok(!g.lageSpielleiter && logbuch(g).filter((e) => e.art === 'abenteuer_bauplan').length === 0, 'kein Lage-Spielleiter, kein Abenteuer-Eintrag');
  ok(Weltstand.validate(Weltstand.capture(g), g).length === 0, 'der Stand bleibt schemagueltig');
  // Lage-Spielleiter an, aber FAEDEN aus: kein Abenteuer-Aufruf, keine Eintraege, byte-gleich zum Bestand (Golden Trace deckt den Rest)
  const t2 = X.spiel({ aus: true, env: Object.assign({}, AN) }), m2 = mitAbenteuer(t2, {}, {}, { lageWerte: { deckel_je_sitzung: LW.deckel_je_sitzung } });
  for (let k = 0; k < 8; k++) await lauf(t2.g);
  ok(m2.asks().length === 0 && abLog(t2.g).length === 0 && m2.llm.asks.some((a) => a.kind === 'lage'), 'ohne FAEDEN=1 plant die Lage wie bisher, die Komposition tut nichts');
  const t3 = X.spiel({ aus: true, env: Object.assign({}, AN) }), m3 = mitAbenteuer(t3, {});
  ok(m3.ab.bereit() === false && m3.ab.beiGrenze('andocken') === null, 'bereit() ist ohne FAEDEN=1 falsch');
});

section('Register aufraeumen: bricht keinen laufenden Faden und kein Angebot', async () => {
  D.zuruecksetzen();
  const t1 = ohneLage(), g1 = t1.g;
  const oeffne = (g, p) => { const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' }); return a.ok ? Faden.abenteuerOeffnen(g, a.angebot.nr) : { ok: false, a }; };
  const r1 = oeffne(g1, planN(1));
  const idA = r1.faden.vorlage;
  ok(r1.ok && D.vorlage(idA) && D.abenteuerAnzahl() === 1, 'ein geoeffnetes Abenteuer steht im Register');
  Faden.abenteuerRegisterAufraeumen(g1);
  ok(D.vorlage(idA) && D.abenteuerAnzahl() === 1, 'es wird referenziert (laufender Faden): das Aufraeumen laesst es stehen');
  r1.faden.phase = 'abgeschlossen'; Faden.abenteuerRegisterAufraeumen(g1);
  ok(D.vorlage(idA) !== null && Weltstand.validate(Weltstand.capture(g1), g1).length === 0, 'auch ein abgeschlossener Faden (noch in der Liste) behaelt seinen Eintrag: der Stand bleibt pruefbar');
  r1.faden.phase = 'wartet';
  // ein zweites Spiel im selben Prozess teilt das Register: was nur Spiel 1 hielt, bleibt, solange Spiel 2 es braucht
  const t2 = ohneLage(), g2 = t2.g, r2 = oeffne(g2, planN(1));
  ok(r2.ok && r2.faden.vorlage === idA && D.abenteuerAnzahl() === 1, 'derselbe Plan in einem zweiten Spiel: ein Eintrag');
  F(g1).liste.length = 0; Faden.abenteuerRegisterAufraeumen(g1);
  ok(D.vorlage(idA) !== null && D.abenteuerAnzahl() === 1, 'Spiel 1 nennt den Plan nicht mehr: er bleibt, weil Spiel 2 einen laufenden Faden damit hat');
  const lauft = F(g2).liste[0];
  for (let k = 0; k < 10; k++) { grenze(g2); Faden.abenteuerRegisterAufraeumen(g2); }
  ok(D.vorlage(idA) && Faden.befehlPruefen(g2, { typ: 'faden_weiter', faden: lauft.id, beat: D.vorlage(lauft.vorlage).beats[0].id }) === null, 'der laufende Faden in Spiel 2 bricht nie (Vorlage da, Beat startbar)');
  F(g2).liste.length = 0; grenze(g2);   // die Taetigkeit raeumt selbst auf (nicht nur der explizite Aufruf)
  ok(D.vorlage(idA) === null && D.abenteuerAnzahl() === 0, 'ohne Faden und ohne Angebot in allen Spielen fliegt der Eintrag raus (beim naechsten Taetigkeitsende)');
  const dauer = D.registriereAbenteuer(BP.expandiere(planN(4)).vorlage);
  ok(dauer.ok && D.abenteuerAnzahl() === 1 && D.raeumeAbenteuerAuf({}, []).entfernt === 0 && D.vorlage(dauer.id) !== null, 'ein Eintrag ohne Besitzer (Tests, Werkstatt) bleibt, auch wenn ein anderer Besitzer aufraeumt');
  const rr = D.raeumeAbenteuerAuf({}, []);
  ok(rr.entfernt === 0 && rr.behalten === 1, 'das Aufraeumen meldet entfernt und behalten');
  D.zuruecksetzen();
  // ein Angebot haelt einen Eintrag, der sonst unreferenziert waere
  const t3 = ohneLage(), g3 = t3.g, r3 = oeffne(g3, planN(2)), idB = r3.faden.vorlage;
  const angebot = Faden.abenteuerAnbieten(g3, planN(2), { hex: '0202' });
  F(g3).liste.length = 0;
  Faden.abenteuerRegisterAufraeumen(g3);
  ok(angebot.ok && D.vorlage(idB) !== null, 'ein offenes Angebot mit demselben Plan haelt den Eintrag (kein Faden mehr)');
  F(g3).abenteuerAngebote.length = 0;
  const rg = Faden.abenteuerRegisterAufraeumen(g3);
  ok(D.vorlage(idB) === null && rg.entfernt === 1 && rg.behalten === 0, 'Angebot weg: der Eintrag faellt weg (entfernt 1)');
  const o = Faden.abenteuerAnbieten(g3, planN(2), { hex: '0305' });
  ok(o.ok && Faden.abenteuerOeffnen(g3, o.angebot.nr).ok && D.vorlage(idB) !== null, 'ein spaeteres Angebot desselben Plans laesst sich oeffnen (der Eintrag wird neu angelegt)');
  // Selbstheilung: fehlt der Eintrag eines laufenden Fadens (Register geleert), traegt ihn das Aufraeumen aus dem Plan des Fadens wieder ein
  D.zuruecksetzen();
  ok(D.vorlage(idB) === null, '(Register von aussen geleert)');
  Faden.abenteuerRegisterAufraeumen(g3);
  ok(D.vorlage(idB) !== null && D.abenteuerAnzahl() === 1, 'der laufende Faden bekommt seinen Eintrag zurueck (aus f.plan)');
  // Wachstum: viele nacheinander geoeffnete und beendete Abenteuer fuellen das Register nicht unbegrenzt
  const t4 = ohneLage(), g4 = t4.g, basis = D.abenteuerAnzahl();
  let max = 0;
  for (let i = 0; i < 25; i++) {
    const r = oeffne(g4, planN(100 + i));
    if (!r.ok) { ok(false, 'oeffnen ' + i + ': ' + JSON.stringify(r.a && r.a.grund)); break; }
    r.faden.phase = 'abgeschlossen';
    max = Math.max(max, D.abenteuerAnzahl() - basis);
  }
  ok(max <= FW.faeden_gesamt_max && D.abenteuerAnzahl() - basis <= FW.faeden_gesamt_max, `25 Abenteuer nacheinander: das Register waechst um hoechstens ${FW.faeden_gesamt_max} (Maximum unterwegs ${max}), nicht um 25`);
  ok(g4.errors === 0 && g1.errors === 0 && g2.errors === 0 && g3.errors === 0, 'kein Serverfehler');
  // entfernt-Zaehler und Fehlerfall: ein ungueltiger Plan in der Liste bricht das Aufraeumen nicht
  const r = D.raeumeAbenteuerAuf({}, [{ id: 'abenteuer_xxxxxxxxxxxx', beats: 5 }, null, 'x']);
  ok(r && Array.isArray(r.fehler) && r.fehler.length === 1, 'unbrauchbare Plaene: gemeldet, kein Absturz');
});

// ======================================================================
const gespeicherteDateien = [];
section('Stufen: Standardwerte, Datei, Umgebung, kaputte Datei, unbekannter Anbieter', () => {
  const S0 = Stufen.lade({});
  const soll = { bauplan: ['claude', 'sonnet'], figuren_haupt: ['claude', 'sonnet'], figuren_neben: ['ollama', null], geruechte_funk: ['ollama', null] };
  ok(S0.fehler.length === 0 && Object.keys(soll).every((k) => S0.stufen[k].anbieter === soll[k][0] && S0.stufen[k].modell === soll[k][1] && S0.stufen[k].eskalation === false && S0.stufen[k].quelle === 'datei'), 'Standard (die ausgelieferte Datei): bauplan und figuren_haupt Claude, figuren_neben und geruechte_funk lokal, keine Eskalation');
  ok(Stufen.abweichend(S0).length === 0 && Router.routerAusEnv({}) === null, 'ohne Aenderung: keine Abweichung, kein Router (Verhalten von main)');
  ok(JSON.stringify(Stufen.STANDARD.bauplan) === JSON.stringify({ anbieter: 'claude', modell: 'sonnet', eskalation: false }), 'die sicheren Standardwerte im Code (Rueckfall bei kaputter Datei)');
  // Zuordnung der Slots des Text-Pools (dokumentiert): Funk, Lagemeldungen und Geruechte -> geruechte_funk; sprechende Nebenfiguren -> figuren_neben
  const slots = Object.keys(require('../content/texte/texte-werte.json').werte.slots.wert);
  const erwartet = { ankuendigung: 'geruechte_funk', eintreffen: 'geruechte_funk', soeldner: 'geruechte_funk', verlust: 'geruechte_funk', dank: 'figuren_neben', reaktion: 'figuren_neben', antwort: 'figuren_neben' };
  ok(slots.length === 7 && slots.every((s) => Stufen.stufeFuerSlot(S0, s) === erwartet[s]), 'jeder Slot des Text-Pools (' + slots.join(', ') + ') gehoert der dokumentierten Stufe');
  // Datei-Ueberschreibung
  const d1 = datei({ format: 'spielleiter-stufen/1', stufen: { bauplan: { anbieter: 'ollama', modell: 'qwen3:32b', eskalation: true }, figuren_neben: { anbieter: 'claude', modell: 'haiku' } }, slots: { dank: 'figuren_haupt' } });
  const S1 = Stufen.lade({ STUFEN_DATEI: d1 });
  ok(S1.fehler.length === 0 && S1.stufen.bauplan.anbieter === 'ollama' && S1.stufen.bauplan.modell === 'qwen3:32b' && S1.stufen.bauplan.eskalation === true && S1.stufen.figuren_neben.anbieter === 'claude' && S1.stufen.figuren_neben.modell === 'haiku' && S1.stufen.geruechte_funk.anbieter === 'ollama' && S1.stufen.figuren_haupt.anbieter === 'claude', 'Datei: bauplan lokal mit Modell und Eskalation, figuren_neben bei Claude, der Rest bleibt');
  ok(Stufen.stufeFuerSlot(S1, 'dank') === 'figuren_haupt' && Stufen.abweichend(S1).join() === 'bauplan,figuren_neben', 'Datei: Slot-Zuordnung aenderbar, Abweichungen erkannt');
  // Umgebung ueberschreibt die Datei; wer den Anbieter wechselt, ohne das Modell zu nennen, bekommt den Standard-Modellnamen des neuen Anbieters (nie sonnet an Ollama)
  const S2 = Stufen.lade({ STUFEN_DATEI: d1, LLM_ANBIETER_BAUPLAN: 'claude', LLM_MODELL_FIGUREN_NEBEN: 'opus', LLM_ANBIETER_GERUECHTE_FUNK: 'claude', LLM_ESKALATION_BAUPLAN: 'aus' });
  ok(S2.stufen.bauplan.anbieter === 'claude' && S2.stufen.bauplan.modell === 'sonnet' && S2.stufen.bauplan.eskalation === false && S2.stufen.figuren_neben.modell === 'opus' && S2.stufen.geruechte_funk.anbieter === 'claude' && S2.stufen.geruechte_funk.modell === 'sonnet', 'Umgebung schlaegt die Datei (Anbieter, Modell, Eskalation); Anbieterwechsel ohne Modell: Standard des neuen Anbieters');
  const S3 = Stufen.lade({ LLM_ANBIETER_BAUPLAN: 'ollama' });
  ok(S3.stufen.bauplan.anbieter === 'ollama' && S3.stufen.bauplan.modell === null, 'Umgebung: Anbieter ollama ohne Modell -> Standard des Transports (null), nie der Claude-Name');
  const S4 = Stufen.lade({ LLM_ANBIETER_BAUPLAN: 'ollama', LLM_MODELL_BAUPLAN: 'gemma4:26b-a4b-it-q4_K_M', LLM_ESKALATION_BAUPLAN: '1' });
  ok(S4.stufen.bauplan.modell === 'gemma4:26b-a4b-it-q4_K_M' && S4.stufen.bauplan.eskalation === true, 'Umgebung: Modell mit Doppelpunkt und Punkten, Eskalation an');
  ok(Stufen.lade({ LLM_ANBIETER_BAUPLAN: 'claude', LLM_ESKALATION_BAUPLAN: '1' }).stufen.bauplan.eskalation === false, 'Eskalation gibt es nur fuer Stufen bei Ollama (Claude eskaliert nicht an sich selbst)');
  ok(Stufen.abweichend(Stufen.lade({ LLM_MODELL_BAUPLAN: 'opus' })).join() === 'bauplan' && Router.routerAusEnv({ LLM_MODELL_BAUPLAN: 'opus' }).arten.bauplan.modell === 'opus', 'ein anderes Modell derselben Stufe zaehlt als Abweichung: der Router entsteht und nutzt es');
  const SD = Stufen.lade({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: { bauplan: { anbieter: 'claude' }, figuren_neben: { anbieter: 'ollama' }, geruechte_funk: { anbieter: 'claude', modell: null } } }) });
  ok(SD.stufen.bauplan.modell === 'sonnet' && SD.stufen.figuren_neben.modell === null && SD.stufen.geruechte_funk.modell === 'sonnet', 'Datei ohne Modell: der Standard des Anbieters (Claude sonnet, Ollama der Standard des Transports)');
  // kaputte Datei: sichere Standardwerte, Fehlermeldung, kein Absturz
  for (const [name, inhalt] of [['kein JSON', '{ nope'], ['leere Datei', ''], ['falsches Format', { format: 'x/1', stufen: {} }], ['unbekannter Anbieter in der Datei', { format: 'spielleiter-stufen/1', stufen: { bauplan: { anbieter: 'openai', modell: 'gpt' } } }], ['Stufen kein Objekt', { format: 'spielleiter-stufen/1', stufen: 5 }]]) {
    const S = Stufen.lade({ STUFEN_DATEI: datei(inhalt) });
    ok(S.fehler.length >= 1 && /stufen\.json/.test(S.fehler[0]) && Object.keys(soll).every((k) => S.stufen[k].anbieter === soll[k][0]) && S.stufen.bauplan.quelle === 'standard' && Stufen.abweichend(S).length === 0, `kaputte Datei (${name}): Fehlermeldung, sichere Standardwerte`);
  }
  const SF = Stufen.lade({ STUFEN_DATEI: path.join(tmp, 'gibt-es-nicht.json') });
  ok(SF.fehler.length === 1 && SF.stufen.bauplan.anbieter === 'claude', 'Datei fehlt: Fehlermeldung, Standardwerte');
  const SU = Stufen.lade({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: { phantasie: { anbieter: 'claude' }, bauplan: { anbieter: 'ollama', modell: 'a b c' } }, slots: { dank: 'phantasie' } }) });
  ok(SU.fehler.length === 3 && SU.stufen.bauplan.anbieter === 'claude' && SU.stufen.bauplan.modell === 'sonnet' && Stufen.stufeFuerSlot(SU, 'dank') === 'figuren_neben', 'unbekannte Stufe, unbrauchbarer Modellname und unbekannte Slot-Stufe: je eine Meldung, der Eintrag bleibt beim Standard');
  // unbekannter Anbieter / Modell in der Umgebung
  const SE = Stufen.lade({ LLM_ANBIETER_BAUPLAN: 'gpt', LLM_MODELL_BAUPLAN: '$(rm -rf)', LLM_ESKALATION_BAUPLAN: 'vielleicht', LLM_ANBIETER_FIGUREN_HAUPT: '' });
  ok(SE.fehler.length === 3 && SE.stufen.bauplan.anbieter === 'claude' && SE.stufen.bauplan.modell === 'sonnet' && SE.stufen.bauplan.eskalation === false && SE.stufen.figuren_haupt.anbieter === 'claude', 'Umgebung: unbekannter Anbieter, unbrauchbarer Modellname, unklarer Schalter: je eine Meldung, sichere Werte');
  ok(Stufen.lade({ STUFEN_DATEI: datei('[1,2]') }).stufen.bauplan.anbieter === 'claude', 'ein Array als Datei stuerzt nicht ab, die Standardwerte gelten');
  gespeicherteDateien.push(d1);
});

section('Stufen im Router: Anbieter und Modell je Stufe, Rueckfall bei Ausfall, Eskalation an/aus', async () => {
  const log = { claude: [], ollama: [] };
  const fake = (name, antworten) => ({ name, async call(text, co) { if (co.kind === 'lage') return { text: '{"befehle": [], "begruendung": "Lage ruhig, Rate frei, nichts zu tun"}', usage: { input: 10, output: 5 }, sec: 0.1 }; log[name].push({ kind: co.kind, stufe: co.stufe, model: co.model, schema: !!co.schema, timeoutMs: co.timeoutMs, signal: !!co.signal }); const a = antworten.shift(); if (a instanceof Error) throw a; return Object.assign({ text: '{}', usage: { input: 1000, output: 500 }, sec: 2.5, modelId: name + '-modell', cost: name === 'claude' ? 0.0123 : 0 }, a || {}); } });
  const offline = () => Object.assign(new Error('Ollama nicht erreichbar'), { code: 'OFFLINE' });
  // Router aus der Umgebung
  const R1 = Router.routerAusEnv({ LLM_ROUTER: '1', LLM_ANBIETER_BAUPLAN: 'ollama', LLM_MODELL_BAUPLAN: 'qwen3:32b' }, { transports: { claude: fake('claude', []), ollama: fake('ollama', [{}, {}, {}, {}]) } });
  ok(R1 && R1.arten.bauplan.anbieter === 'ollama' && R1.arten.bauplan.modell === 'qwen3:32b' && R1.arten.figuren_haupt.anbieter === 'claude' && R1.anbieterFuer('abenteuer') === 'ollama' && R1.anbieterFuer('abenteuer', 'figuren_haupt') === 'claude', 'LLM_ANBIETER_BAUPLAN=ollama: kind abenteuer geht an Ollama, die Stufe der Anfrage geht vor der Art');
  await R1.call('x', { kind: 'abenteuer', model: 'sonnet', system: 'y' });
  await R1.call('x', { kind: 'text', stufe: 'figuren_neben', system: 'y' });
  await R1.call('x', { kind: 'text', stufe: 'geruechte_funk' });
  await R1.call('x', { kind: 'text' });
  ok(log.ollama.length === 4 && log.ollama[0].model === 'qwen3:32b' && log.ollama[1].model === undefined && log.claude.length === 0, 'Aufrufe: Modell der Stufe, text ohne Stufe wie bisher (ollama), Claude nicht beruehrt');
  // Datei ueber die Umgebung (STUFEN_DATEI): ein Router entsteht, weil eine Stufe abweicht
  const R2 = Router.routerAusEnv({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: { figuren_neben: { anbieter: 'claude', modell: 'haiku' } } }) });
  ok(R2 && R2.arten.figuren_neben.anbieter === 'claude' && R2.arten.figuren_neben.modell === 'haiku' && R2.arten.geruechte_funk.anbieter === 'ollama', 'eine Datei mit abweichender Stufe erzeugt einen Router mit dieser Stufe');
  ok(Router.routerAusEnv({ STUFEN_DATEI: datei('{ kaputt') }) === null && Router.routerAusEnv({ LLM_ANBIETER_BAUPLAN: 'gpt' }) === null, 'kaputte Datei und unbekannter Anbieter: sichere Standardwerte, kein Router, kein Absturz');
  ok(Router.routerAusEnv({ LLM_ANBIETER_BAUPLAN: 'gpt' }) === null && (Router.routerAusEnv({ LLM_ROUTER: '1', LLM_ANBIETER_BAUPLAN: 'gpt' }).warnungen || []).some((w) => /LLM_ANBIETER_BAUPLAN/.test(w)), 'die Meldung steht in den Warnungen des Routers');

  { const rt = Router.routeTransport({ figuren_neben: { anbieter: 'claude', modell: 'haiku' } }, { transports: { claude: fake('claude', []), ollama: fake('ollama', []) } });
    const llm = LLM.create({ mode: 'live', transport: rt });
    ok(llm.anbieterFuer('text', 'figuren_neben') === 'claude' && llm.anbieterFuer('text') === 'ollama' && llm.anbieterFuer('abenteuer') === 'claude' && LLM.create({ mode: 'mock' }).anbieterFuer('text', 'figuren_neben') === 'claude', 'llm.anbieterFuer(kind, stufe): die Stufe geht vor der Art (nur im Modus live)'); }
  // Eskalation aus der Umgebung und ueber llm.eskaliere: nur die Stufe mit eskalation: true geht an Claude
  const R3 = Router.routerAusEnv({ LLM_ROUTER: '1', LLM_ANBIETER_BAUPLAN: 'ollama', LLM_ESKALATION_BAUPLAN: '1' }), R4 = Router.routerAusEnv({ LLM_ROUTER: '1', LLM_ANBIETER_BAUPLAN: 'ollama' });
  ok(R3.eskalationFuer('abenteuer') === 'claude' && R4.eskalationFuer('abenteuer') === null && R4.eskalationFuer('text') === 'claude', 'LLM_ESKALATION_BAUPLAN=1: die Stufe eskaliert, ohne den Schalter nicht');
  await mitLive(async () => {
    log.claude.length = 0; log.ollama.length = 0;
    const rt = Router.routeTransport({ geruechte_funk: { anbieter: 'ollama', eskalation: true }, figuren_neben: { anbieter: 'ollama' } }, { transports: { claude: fake('claude', [{}]), ollama: fake('ollama', [{}]) } });
    const llm = LLM.create({ mode: 'live', transport: rt });
    await llm.eskaliere('text', { prompt: 'x', system: 'y' }, { stufe: 'figuren_neben' });
    ok(log.ollama.length === 1 && log.claude.length === 0, 'eskaliere fuer eine Stufe ohne Schalter: bleibt beim Anbieter der Stufe');
    await llm.eskaliere('text', { prompt: 'x', system: 'y' }, { stufe: 'geruechte_funk' });
    ok(log.claude.length === 1 && log.claude[0].stufe === 'geruechte_funk', 'eskaliere fuer die Stufe mit Schalter: geht an Claude');
  });
  // Aufruf-Matrix ueber die ganze Kette (Spiel, Abenteuer-Spielleiter, llm live, Router, Fake-Transporte)
  const lauf1 = async (stufe, antworten, werte) => mitLive(async () => {
    log.claude.length = 0; log.ollama.length = 0;
    const router = Router.routeTransport({ bauplan: stufe }, { eskalation: undefined, transports: { claude: fake('claude', antworten.claude || []), ollama: fake('ollama', antworten.ollama || []) } });
    const llm = LLM.create({ mode: 'live', transport: router });
    const t = spiel(); const m = mitAbenteuer(t, null, werte || {}, { llm });
    await lauf(t.g);
    return { t, m, e: abLog(t.g).filter((x) => x.ausgang !== 'uebersprungen' && x.ausgang !== 'eskaliert'), angebote: F(t.g).abenteuerAngebote.length };
  });
  const gut = (p) => ({ text: JSON.stringify(p || planN(9)) });
  // Claude (Standard): gueltig, Messung vollstaendig
  let r = await lauf1({ anbieter: 'claude', modell: 'sonnet' }, { claude: [gut()] });
  ok(r.e.length === 1 && r.e[0].ausgang === 'gueltig' && r.e[0].anbieter === 'claude' && r.e[0].modell === 'claude-modell' && r.e[0].tokens === 1500 && r.e[0].dauer_s === 2.5 && r.e[0].geld === 0.0123 && r.angebote === 1 && log.claude[0].model === 'sonnet' && log.claude[0].kind === 'abenteuer' && !log.claude[0].schema && log.claude[0].timeoutMs === 1000 * AW.timeout_s && log.claude[0].signal, 'Claude: gueltig, Anbieter, Modell, Tokens (1500), Dauer, Geld (0,0123 USD) im Logbuch');
  // Ollama: lokal, kein Geld
  r = await lauf1({ anbieter: 'ollama', modell: 'qwen3:32b' }, { ollama: [gut()] });
  ok(r.e[0].ausgang === 'gueltig' && r.e[0].anbieter === 'ollama' && r.e[0].geld === 0 && log.ollama[0].model === 'qwen3:32b' && log.claude.length === 0, 'Ollama: gueltig, Anbieter ollama, Geld 0, Modell der Stufe, Claude nicht gefragt');
  // Ausfall bei Ollama ohne Eskalation: Rueckfall = kein Angebot, Eintrag, Claude nicht gefragt
  r = await lauf1({ anbieter: 'ollama' }, { ollama: [offline()], claude: [gut()] });
  ok(r.e.length === 1 && r.e[0].ausgang === 'ausfall' && r.e[0].grund === 'OFFLINE' && r.e[0].anbieter === 'ollama' && r.angebote === 0 && log.claude.length === 0 && r.t.g.errors === 0, 'Ollama ausgefallen, Eskalation aus (Standard): kein Angebot, Eintrag ausfall OFFLINE, Claude nicht gefragt');
  // Ausfall bei Ollama mit Eskalation: einmal Claude
  r = await lauf1({ anbieter: 'ollama', eskalation: true }, { ollama: [offline()], claude: [gut()] });
  ok(r.e.length === 1 && r.e[0].ausgang === 'gueltig' && r.e[0].anbieter === 'claude' && r.e[0].eskaliert === true && r.angebote === 1 && log.claude.length === 1 && log.ollama.length === 1, 'Ollama ausgefallen, Eskalation an: einmal Claude, gueltig, im Logbuch eskaliert');
  ok(abLog(r.t.g, 'eskaliert').length === 1, 'die Eskalation steht als eigener Eintrag (art abenteuer_bauplan, ausgang eskaliert)');
  // Ollama liefert Muell: ohne Eskalation abgelehnt, mit Eskalation Claude
  r = await lauf1({ anbieter: 'ollama' }, { ollama: [{ text: 'ich weiss nicht' }], claude: [gut()] });
  ok(r.e[0].ausgang === 'abgelehnt' && r.e[0].grund === 'ANTWORT_UNLESBAR' && r.angebote === 0 && log.claude.length === 0, 'Ollama liefert Muell, Eskalation aus: abgelehnt, kein Angebot');
  r = await lauf1({ anbieter: 'ollama', eskalation: true }, { ollama: [{ text: 'ich weiss nicht' }], claude: [gut()] });
  ok(r.e.length === 1 && r.e[0].ausgang === 'gueltig' && r.e[0].eskaliert === true && r.angebote === 1 && log.claude.length === 1, 'Ollama liefert Muell, Eskalation an: Claude liefert, gueltig');
  // Eskalation hoechstens einmal: auch Claude faellt aus
  r = await lauf1({ anbieter: 'ollama', eskalation: true }, { ollama: [offline()], claude: [Object.assign(new Error('weg'), { code: 'EXIT' })] });
  ok(r.e.length === 1 && r.e[0].ausgang === 'ausfall' && r.e[0].eskaliert === true && r.angebote === 0 && log.claude.length === 1 && log.ollama.length === 1 && r.m.ab.zustand === 'idle', 'beide ausgefallen: ein Ausfall-Eintrag, kein dritter Versuch, Spielleiter frei');
  // Claude ausgefallen: eskaliert nie an sich selbst
  r = await lauf1({ anbieter: 'claude' }, { claude: [Object.assign(new Error('weg'), { code: 'EXIT' })] });
  ok(r.e[0].ausgang === 'ausfall' && r.e[0].anbieter === 'claude' && log.claude.length === 1 && r.angebote === 0, 'Claude ausgefallen: kein Angebot, keine Eskalation an sich selbst');
  // Budget: eine Stufe bei Claude zaehlt, bei Ollama nicht
  LLM.setBudgetLimit(100);
  r = await lauf1({ anbieter: 'claude' }, { claude: [gut()] });
  ok(r.e.length === 0 && r.m.ab.zaehler.uebersprungen.budget === 1 && log.claude.length === 0, 'Token-Budget leer: Claude wird nicht gefragt (budget)');
  r = await lauf1({ anbieter: 'ollama' }, { ollama: [gut()] });
  ok(r.e[0].ausgang === 'gueltig', 'dasselbe Budget stoert eine Stufe bei Ollama nicht');
  LLM.resetBudget();
});

section('Text-Pool: Stufen je Slot, ohne Eintrag wie vorher', async () => {
  await mitLive(async () => {
    const lauf2 = async (env, slot) => {
      Pool.zuruecksetzen();
      const modelle = [];
      const srv = await H.fakeOllama((req, res, body) => { if (req.url === '/api/version') return H.antwort(res, 200, { version: 'f' }); modelle.push(body.model); H.antwort(res, 200, { model: body.model, message: { role: 'assistant', content: JSON.stringify({ text: 'Fahrt weiter nach Nord.' }) }, done: true, prompt_eval_count: 5, eval_count: 5 }); });
      try {
        const g = ohneLage({ env: Object.assign({ REISE_EREIGNISSE: '1', TEXTE_POOL: '1', LLM_LIVE: '1', OLLAMA_URL: srv.url, OLLAMA_MODEL: 'fake:1b', LLM_MODELL_TEXT: 'fake:2b' }, env) }).g;
        const llm = Pool.getLlm(g);
        const spec = Pool.katalogSpecs().find((s) => s.slot === slot);
        await Pool.versuch(llm, spec, { namen: [] });
        return { modelle, llm, g };
      } finally { await srv.close(); }
    };
    // ohne Eintrag: wie in 03b (Modell aus LLM_MODELL_TEXT, nur Ollama, keine Eskalation)
    let r = await lauf2({}, 'ankuendigung');
    ok(r.modelle.length === 1 && r.modelle[0] === 'fake:2b' && r.llm.anbieterFuer('text') === 'ollama' && r.llm.anbieterFuer('text', 'geruechte_funk') === 'ollama' && !r.llm.eskalationMoeglich('text') && !r.llm.eskalationMoeglich('text', 'geruechte_funk'), 'ohne Eintrag: Modell aus LLM_MODELL_TEXT, Ollama, keine Eskalation (wie 03b)');
    r = await lauf2({}, 'dank');
    ok(r.modelle[0] === 'fake:2b', 'ohne Eintrag: auch der Slot dank (figuren_neben) nimmt LLM_MODELL_TEXT');
    // Datei und Umgebung je Stufe
    const d = datei({ format: 'spielleiter-stufen/1', stufen: { figuren_neben: { anbieter: 'ollama', modell: 'neben:3b' } } });
    r = await lauf2({ STUFEN_DATEI: d, LLM_MODELL_GERUECHTE_FUNK: 'funk:7b' }, 'ankuendigung');
    ok(r.modelle[0] === 'funk:7b', 'Umgebung LLM_MODELL_GERUECHTE_FUNK: der Slot ankuendigung (geruechte_funk) laeuft mit dem Modell der Stufe');
    r = await lauf2({ STUFEN_DATEI: d, LLM_MODELL_GERUECHTE_FUNK: 'funk:7b' }, 'reaktion');
    ok(r.modelle[0] === 'neben:3b', 'Datei: der Slot reaktion (figuren_neben) laeuft mit dem Modell aus der Datei');
    r = await lauf2({ STUFEN_DATEI: datei('{ kaputt') }, 'verlust');
    ok(r.modelle[0] === 'fake:2b' && r.g.errors === 0, 'kaputte Datei: der Text-Pool laeuft wie vorher (Modell aus LLM_MODELL_TEXT)');
    ok(logbuch(r.g).some((e) => e.art === 'text_pool' && e.key === 'stufen' && /stufen\.json/.test((e.fehler || [''])[0])), 'kaputte Datei: Eintrag im Regie-Logbuch');
    r = await lauf2({ LLM_ESKALATION_GERUECHTE_FUNK: '1' }, 'soeldner');
    ok(r.llm.eskalationMoeglich('text', 'geruechte_funk') === true && r.llm.eskalationMoeglich('text', 'figuren_neben') === false && r.llm.eskalationMoeglich('abenteuer') === false, 'LLM_ESKALATION_GERUECHTE_FUNK=1: nur diese Stufe darf an Claude eskalieren');
  });
  // Eskalation im Pool: Ausfall und ungueltige Antwort der Stufe gehen einmal an Claude, ohne den Schalter nie (Fake-LLM)
  const Pruefer = require('../server/sim/texte-pruefer.js');
  const spec = Pool.katalogSpecs().find((s) => s.slot === 'ankuendigung');
  const fakeLlm = (esk, antworten, erlaubt) => { const l = { ask: async (k, i, o) => { l.calls.push(['ask', k, o.stufe]); const a = antworten.shift(); if (a instanceof Error) throw a; return a; }, eskaliere: async (k, i, o) => { l.calls.push(['esk', k, o.stufe]); return Object.assign({ eskaliert: true }, esk); }, eskalationMoeglich: () => erlaubt, calls: [] }; return l; };
  const gut = { text: JSON.stringify({ text: 'Fahrt weiter nach Nord, die Strasse ist frei.' }), tokens: 10, sec: 1 };
  const aus = Object.assign(new Error('weg'), { code: 'OFFLINE' });
  let l = fakeLlm(gut, [aus], true), v = await Pool.versuch(l, spec, { namen: [] });
  ok(l.calls.map((c) => c.join(':')).join() === 'ask:text:geruechte_funk,esk:text:geruechte_funk' && v.r.eskaliert === true, 'Pool: Ausfall der Stufe -> einmal eskaliert (nur mit erlaubter Eskalation)');
  l = fakeLlm(gut, [Object.assign(new Error('abgebrochen'), { code: 'ABORTED' })], true); let abg = null;
  try { await Pool.versuch(l, spec, { namen: [] }); } catch (e) { abg = e; }
  ok(abg && abg.code === 'ABORTED' && l.calls.length === 1, 'Pool: ein Abbruch (ABORTED) eskaliert nie');
  l = fakeLlm(gut, [aus], false); let fehler = null;
  try { await Pool.versuch(l, spec, { namen: [] }); } catch (e) { fehler = e; }
  ok(fehler && fehler.code === 'OFFLINE' && l.calls.length === 1, 'Pool: Eskalation aus -> der Fehler geht weiter (Katalogtext bleibt)');
  void Pruefer;
  // der ganze Job: ungueltige Antworten der Stufe (beide Versuche) gehen einmal an Claude, wenn die Stufe es erlaubt; sonst bleibt der Katalogtext
  for (const erlaubt of [true, false]) {
    Pool.zuruecksetzen();
    const g = ohneLage({ env: { REISE_EREIGNISSE: '1', TEXTE_POOL: '1', LLM_LIVE: '1' } }).g;
    const kaputt = { text: JSON.stringify({ text: 'Muell {{lex.x}} 12' }), tokens: 5, sec: 0.1 };
    const woerter = ['Nord', 'Sued', 'Ost', 'West'];
    const guterText = (prompt) => { const pf = /im Text müssen vorkommen: ([^.]*)./.exec(prompt); const wort = (/Der (Hafen|Posten) /.exec(prompt) || [null, ''])[1]; return `Funker ${woerter[0]} ${woerter[1]} ${woerter[2]} ruft die Lerche und bleibt wachsam ${wort} ${pf ? pf[1].split(',').map((x) => x.trim()).join(' ') : ''}.`.replace(/s+/g, ' '); };
    const l2 = fakeLlm(gut, [kaputt, kaputt], erlaubt); l2.mode = 'live';
    l2.eskaliere = async (k, i, o) => { l2.calls.push(['esk', k, o.stufe]); return { text: JSON.stringify({ text: guterText(i.prompt) }), tokens: 7, sec: 0.2, eskaliert: true, anbieter: 'claude', modell: 'claude-x' }; };
    Pool.setLlm(l2);
    Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
    const st = Pool.stand(), e = logbuch(g).filter((x) => x.art === 'text_pool');
    if (erlaubt) ok(st.gesamt === 1 && st.zaehler.gueltig_2 === 1 && l2.calls.filter((c) => c[0] === 'ask').length === 2 && l2.calls.filter((c) => c[0] === 'esk').length === 1 && e.length === 1 && e[0].ausgang === 'gueltig' && e[0].eskaliert === true, 'Pool-Job, Eskalation erlaubt: nach zwei ungueltigen Antworten liefert Claude einmal, der Eintrag steht als eskaliert im Logbuch');
    else ok(st.gesamt === 0 && st.zaehler.ungueltig === 1 && l2.calls.filter((c) => c[0] === 'esk').length === 0 && e[0].ausgang === 'ungueltig' && e[0].eskaliert === undefined, 'Pool-Job, Eskalation nicht erlaubt: kein Text, der Katalogtext bleibt, nie Claude');
  }
  Pool.zuruecksetzen();
});

section('Logbuch und Bericht: abenteuer_bauplan mit Anbieter, Modell, Tokens, Dauer, Geld', async () => {
  const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ json: planN(1), tokens: 777 }, { text: 'Muell', tokens: 20 }, { error: 'exit' }] } }, { cooldown_grenzen: 1, deckel_je_sitzung: 99 });
  for (let k = 0; k < 3; k++) await lauf(t.g);
  const e = abLog(t.g).filter((x) => x.ausgang !== 'uebersprungen');
  ok(e.length === 3 && e.map((x) => x.ausgang).join() === 'gueltig,abgelehnt,ausfall', 'drei Aufrufe: gueltig, abgelehnt, ausfall');
  ok(e.every((x) => x.art === 'abenteuer_bauplan' && x.quelle === 'mock' && x.anbieter === 'mock' && x.modell === 'mock' && x.geld === 0 && typeof x.dauer_s === 'number' && 'tokens' in x && x.plan && x.plan.sitzung && x.plan.nr >= 1), 'jeder Eintrag: art, Anbieter, Modell, Tokens, Dauer, Geld, Sitzung und Nummer');
  ok(e[0].tokens === 777 && e[1].tokens === 20 && e[1].grund === 'ANTWORT_UNLESBAR' && e[2].grund === 'EXIT' && e[0].plan.typen.join() === 'spontanhilfe' && e[0].plan.angebot === 1, 'Tokens, Grund und Typenfolge stehen im Eintrag');
  ok(!JSON.stringify(e).includes('Probe 1') && !JSON.stringify(e).includes('Probeanlass'), 'Titel und Anlass stehen nie im Logbuch-Eintrag der Komposition');
  const dir = path.join(tmp, 'regie');
  const id = 'abenteuer-bericht';
  const log = Regielog.create({ dir, weltId: id });
  for (const x of logbuch(t.g)) log.write(x);
  const md = Bericht.report(dir, id);
  ok(/## Abenteuer-Komposition \(Stufe bauplan\)/.test(md) && /Aufrufe: \*\*3\*\* \(gültig 1, abgelehnt 1, Ausfall 1\)/.test(md) && /ANTWORT_UNLESBAR 1/.test(md) && /EXIT 1/.test(md) && /mock\/mock 3/.test(md) && /Tokens: 797/.test(md) && /Geld: 0 USD/.test(md), 'Bericht: Abschnitt Abenteuer-Komposition mit Ausgang, Code, Anbieter, Tokens, Geld');
  ok(/Tokens gesamt: \*\*797\*\*/.test(md), 'die Tokens der Komposition zaehlen in die Gesamtsumme');
  // Geld bei Claude (Fake-Transport)
  const eintrag = { art: 'abenteuer_bauplan', ausgang: 'gueltig', anbieter: 'claude', modell: 'claude-x', tokens: 1500, dauer_s: 2.5, geld: 0.0123, plan: { sitzung: 's' } };
  const log2 = Regielog.create({ dir, weltId: 'abenteuer-geld' }); log2.write(eintrag); log2.write(eintrag);
  log2.write({ art: 'abenteuer_bauplan', ausgang: 'uebersprungen', grund: 'cooldown' }); log2.write({ art: 'abenteuer_bauplan', ausgang: 'eskaliert', grund: 'OFFLINE' });
  const md2 = Bericht.report(dir, 'abenteuer-geld');
  ok(/Geld: 0,0246 USD/.test(md2) && Regielog.read(dir, 'abenteuer-geld').entries[0].geld === 0.0123, 'Bericht: Geld summiert (0,0246 USD), das Feld geld ueberlebt das Logbuch');
  ok(/Dauer je Aufruf: Median 2,5 s, p90 2,5 s/.test(md2) && /Übersprungene Grenzen: cooldown 1/.test(md2) && /eskaliert: 1,/.test(md2) && /Aufrufe: \*\*2\*\*/.test(md2), 'Bericht: Dauer (Median, p90), uebersprungene Grenzen und Eskalationen; Uebersprungenes und Eskalations-Marker zaehlen nicht als Aufruf');
  const log3 = Regielog.create({ dir, weltId: 'abenteuer-dauer' });
  for (const s of [1, 2, 3, 4, 10]) log3.write({ art: 'abenteuer_bauplan', ausgang: 'gueltig', anbieter: 'claude', modell: 'x', tokens: 1, dauer_s: s, geld: 0, plan: { sitzung: 's' } });
  ok(/Dauer je Aufruf: Median 3 s, p90 10 s/.test(Bericht.report(dir, 'abenteuer-dauer')), 'Bericht: Median 3 s und p90 10 s bei den Dauern 1, 2, 3, 4, 10');
  // kaputte Stufendatei: ein Eintrag je Sitzung
  const t2 = spiel({ env: { STUFEN_DATEI: datei('{ kaputt') } });
  const sl = LS.create(t2.g, { mode: 'mock' });
  sl.getLlm(); sl.getLlm();
  const k = logbuch(t2.g).filter((x) => x.art === 'stufen_konfig');
  ok(k.length === 1 && k[0].ausgang === 'fehler' && /stufen\.json/.test(k[0].fehler[0]), 'kaputte Stufendatei: ein Eintrag stufen_konfig im Logbuch, kein Absturz');
  sl.dispose();
  const t3 = spiel(), sl3 = LS.create(t3.g, { mode: 'mock' });
  sl3.getLlm();
  ok(logbuch(t3.g).filter((x) => x.art === 'stufen_konfig').length === 0, 'ohne Fehler in der Stufen-Konfiguration kein Eintrag stufen_konfig');
  sl3.dispose();
});

section('Speichern und Laden mit offenem Angebot und laufendem Abenteuer', async () => {
  const t = spiel(), m = mitAbenteuer(t, { mode: 'script', script: { abenteuer: [{ json: PLAN_VOLL }, { json: planN(2) }] } }, { cooldown_grenzen: 1 });
  await lauf(t.g);
  ok(F(t.g).abenteuerAngebote.length === 1, 'ein Angebot liegt aus (vom Spielleiter komponiert)');
  const r = Faden.abenteuerOeffnen(t.g, F(t.g).abenteuerAngebote[0].nr);
  ok(r.ok && r.faden.plan, 'das Abenteuer laeuft');
  await lauf(t.g);
  ok(F(t.g).abenteuerAngebote.length === 1, 'ein zweites Angebot liegt neben dem laufenden Abenteuer aus');
  const data = Weltstand.capture(t.g);
  const sim = JSON.parse(JSON.stringify(data.welt.sim));
  ok(data.version === 3 && Weltstand.validate(data, t.g).length === 0 && sim.faeden.liste[0].plan && !('abenteuerAngebote' in sim.faeden) && sim.faeden.abenteuer.angebote.length === 1, 'Weltstand-Version 3, schemagueltig, der Plan steht im Stand, das Angebot im Block abenteuer (SUND-04b C)');
  D.zuruecksetzen();   // wie ein neuer Prozess
  const t2 = spiel(), m2 = mitAbenteuer(t2, {});
  Kriegslage.restore(t2.g, sim);
  const f2 = F(t2.g).liste[0];
  ok(f2 && f2.plan && D.vorlage(f2.vorlage) && F(t2.g).abenteuerAngebote.length === 1 && D.vorlage(F(t2.g).abenteuerAngebote[0].ref) && F(t2.g).ladeFehler.length === 0, 'nach dem Laden: das Abenteuer ist da (Plan, Register) und das offene Angebot (SUND-04b C: steht im Stand, der Plan laeuft erneut durch den Pruefer), keine Ladefehler');
  ok(JSON.stringify(Faden.toSave(t2.g.weltsim)) === JSON.stringify(sim.faeden), 'Speichern nach dem Laden ergibt denselben Block');
  Faden.abenteuerRegisterAufraeumen(t2.g);
  ok(D.vorlage(f2.vorlage) !== null, 'Aufraeumen nach dem Laden laesst den laufenden Faden stehen');
  const idGeladen = f2.vorlage, liste2 = F(t2.g).liste.slice();
  F(t2.g).liste.length = 0; Faden.abenteuerRegisterAufraeumen(t2.g);
  ok(D.vorlage(idGeladen) === null, 'ein beim Laden eingetragener Plan hat einen Besitzer: ohne Faden faellt er wieder weg');
  F(t2.g).liste.push(...liste2); Faden.abenteuerRegisterAufraeumen(t2.g);   // der Eintrag kommt aus dem Plan des Fadens zurueck
  ok(D.vorlage(idGeladen) !== null, '(und kommt mit dem Faden zurueck)');
  await lauf(t2.g);
  ok(m2.asks().length === 1 && t2.g.errors === 0 && F(t2.g).abenteuerAngebote.length <= 2, 'der Spielleiter komponiert in der neuen Sitzung weiter (Aufrufe der Sitzung zaehlen neu)');
  void m;
});

// ======================================================================
section('Nacharbeit A2: Router nur wegen der Stufen, Takt neben dem Lage-Plan, Eskalation nur bei Modellfehlern, ENOENT, veraltete Jobs, Text-Pool-Umgebung, Stufen-Datei', async () => {
  const mkFake = (name, antworten, log) => ({ name, async call(text, co) { log.push(co.kind); const a = antworten.shift(); if (a instanceof Error) throw a; return Object.assign({ text: '{}', usage: { input: 1000, output: 500 }, sec: 1, modelId: name + '-m', cost: 0 }, a || {}); } });
  // ---- (1) Stufen-Abweichung allein macht aus grobplan/szene/text/lage keinen Ollama-Weg
  for (const [name, env] of [['LLM_MODELL_FIGUREN_NEBEN', { LLM_MODELL_FIGUREN_NEBEN: 'haiku' }], ['Eintrag in stufen.json', { STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: { figuren_neben: { anbieter: 'claude', modell: 'haiku' } } }) }], ['LLM_ANBIETER_BAUPLAN', { LLM_ANBIETER_BAUPLAN: 'ollama' }]]) {
    const R = Router.routerAusEnv(env);
    ok(R && ['grobplan', 'szene', 'text', 'lage'].every((k) => R.anbieterFuer(k) === 'claude' && R.eskalationFuer(k) === null), `${name}: grobplan, szene, text und lage bleiben bei Claude (Verhalten von main), keine neue Eskalation`);
  }
  { const R = Router.routerAusEnv({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: { figuren_neben: { anbieter: 'claude', modell: 'haiku' }, bauplan: { anbieter: 'ollama' } } }) });
    ok(R.anbieterFuer('text', 'figuren_neben') === 'claude' && R.anbieterFuer('abenteuer') === 'ollama' && R.anbieterFuer('text', 'geruechte_funk') === 'ollama' && R.anbieterFuer('text') === 'claude', 'die Stufen selbst nutzen den Router (bauplan bei Ollama, figuren_neben bei Claude, geruechte_funk wie im Standard bei Ollama), die Art text bleibt bei Claude'); }
  { const R = Router.routerAusEnv({ LLM_ROUTER: '1', LLM_MODELL_FIGUREN_NEBEN: 'haiku' });
    ok(R.anbieterFuer('szene') === 'ollama' && R.anbieterFuer('text') === 'ollama' && R.anbieterFuer('lage') === 'claude', 'LLM_ROUTER=1 gewaehlt: die Standardzuordnung (szene, text bei Ollama) gilt weiter'); }
  ok(Router.routerAusEnv({}) === null && Router.routerAusEnv({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: {} }) }) === null, 'ohne jede Abweichung: kein Router');

  // ---- (4) Lage-Plan und Komposition starten an derselben Grenze nie zwei Prozesse
  { const t = spiel(), m = mitAbenteuer(t, { mode: 'mock' }, {}, { lageWerte: { deckel_je_sitzung: LW.deckel_je_sitzung } });
    grenze(t.g);
    ok(m.sl.zustand === 'angefragt' && m.ab.zustand === 'idle' && m.ab.aufrufe === 0 && m.ab.zaehler.uebersprungen.lage_beschaeftigt === 1, 'der Lage-Plan startet an der Grenze: die Komposition wartet (lage_beschaeftigt), kein Aufruf, kein Deckel-Verbrauch');
    ok(abLog(t.g, 'uebersprungen').length === 1 && abLog(t.g, 'uebersprungen')[0].grund === 'lage_beschaeftigt', 'der Grund steht im Logbuch');
    await pumpen(t.g, 4);
    ok(m.sl.zustand === 'idle' && m.asks().length === 0, 'der Lage-Plan ist durch, die Komposition hat nicht nachgeholt');
    await lauf(t.g);
    ok(m.asks().length === 1 && m.ab.aufrufe === 1 && m.ab.zaehler.uebersprungen.cooldown === undefined, 'an der naechsten Grenze startet die Komposition (der Sprung zaehlte weder als Aufruf noch als Cooldown)'); }

  await mitLive(async () => {
    const rig = (ollamaA, claudeA, werte) => {
      const lo = [], lc = [];
      const rt = Router.routeTransport({ bauplan: { anbieter: 'ollama', eskalation: true } }, { transports: { claude: mkFake('claude', claudeA || [], lc), ollama: mkFake('ollama', ollamaA, lo) } });
      const t = spiel(), m = mitAbenteuer(t, null, Object.assign({ cooldown_grenzen: 1, deckel_je_sitzung: 99 }, werte || {}), { llm: LLM.create({ mode: 'live', transport: rt }) });
      return { t, m, lo, lc };
    };
    const P = planN(9);
    // ---- (5) Eskalation nur bei Fehlern, die am Modell liegen
    { const r = rig([{ text: JSON.stringify(P) }]);
      grenze(r.t.g); r.t.g.step();
      Faden.abenteuerAnbieten(r.t.g, P, { hex: '0305' });   // dasselbe Abenteuer liegt schon aus, waehrend die Antwort unterwegs ist
      await frei(); r.t.g.step(); await pumpen(r.t.g, 2);
      ok(abLog(r.t.g, 'abgelehnt').length === 1 && abLog(r.t.g, 'abgelehnt')[0].grund === 'ABENTEUER_DOPPELT' && abLog(r.t.g, 'eskaliert').length === 0 && r.lc.length === 0, 'ABENTEUER_DOPPELT: abgelehnt, nicht an Claude eskaliert'); }
    { const r = rig([{ text: JSON.stringify(P) }]);
      grenze(r.t.g); r.t.g.step();
      [['0202', 1], ['0203', 2], ['0204', 3]].forEach(([h, i]) => Faden.abenteuerAnbieten(r.t.g, planN(i), { hex: h }));
      await frei(); r.t.g.step(); await pumpen(r.t.g, 2);
      ok(abLog(r.t.g, 'abgelehnt').length === 1 && abLog(r.t.g, 'abgelehnt')[0].grund === 'ABENTEUER_ANGEBOTE' && abLog(r.t.g, 'eskaliert').length === 0 && r.lc.length === 0, 'ABENTEUER_ANGEBOTE: abgelehnt, nicht an Claude eskaliert'); }
    { const r = rig([{ text: 'kein json' }], [{ text: JSON.stringify(P) }]);
      await lauf(r.t.g); await pumpen(r.t.g, 3);
      ok(r.lc.length === 1 && abLog(r.t.g, 'eskaliert').length === 1 && F(r.t.g).abenteuerAngebote.length === 1, 'Gegenprobe: eine unlesbare Antwort (liegt am Modell) geht weiter einmal an Claude'); }
    // ---- (6) fehlende Claude-CLI bei der Eskalation schaltet nicht die ganze Komposition ab, wenn die Stufe bei Ollama liegt
    { const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      const r = rig([{ text: 'kein json' }, { text: 'kein json' }], [enoent]);
      await lauf(r.t.g); await pumpen(r.t.g, 4);
      ok(r.m.ab.aus === null && !!r.m.ab.eskalationAus && abLog(r.t.g, 'ausfall').length === 1 && abLog(r.t.g, 'ausfall')[0].grund === 'ENOENT', 'ENOENT bei der Eskalation: nur die Eskalation ist aus, die Komposition (Ollama) bleibt an');
      await lauf(r.t.g); await pumpen(r.t.g, 3);
      ok(r.lo.length === 2 && r.lc.length === 1 && !r.m.ab.zaehler.uebersprungen.transport_aus && abLog(r.t.g, 'abgelehnt').length === 1, 'der naechste Aufruf geht wieder an Ollama, Claude wird nicht noch einmal gefragt'); }
    // ---- (7) veralteter Job: weder Ausfall noch Eskalation noch Ablehnung fassen den Zustand an
    { const r = rig([{ text: '{}' }], [{ text: '{}' }]);
      grenze(r.t.g); r.t.g.step();
      const alt = r.m.ab.job, neu = Object.assign({}, alt, { token: alt.token + 100, nr: 99 });
      r.m.ab.job = neu;
      const vorher = JSON.stringify(r.m.ab.zaehler), eintraege = abLog(r.t.g).length, claude = r.lc.length;
      r.m.ab.ausfall(alt, Object.assign(new Error('weg'), { code: 'OFFLINE' }), null);
      r.m.ab.abgelehnt(alt, 'ANTWORT_UNLESBAR', ['x'], null);
      ok(r.m.ab.eskalieren(alt, 'OFFLINE') === false && r.m.ab.job === neu && r.m.ab.zustand === 'laeuft' && JSON.stringify(r.m.ab.zaehler) === vorher && abLog(r.t.g).length === eintraege && r.lc.length === claude, 'veralteter Job: ausfall, abgelehnt und eskalieren aendern nichts (neuer Job, Zaehler, Logbuch, Claude)'); }
  });

  // ---- (8) Text-Pool: Eskalations-Umgebung und Umgebung des Spiels
  await mitLive(async () => {
    const echt = Router.routeTransport; let erfasst = null;
    Router.routeTransport = (arten, o) => { erfasst = o; return echt(arten, o); };
    try {
      const basis = { REISE_EREIGNISSE: '1', TEXTE_POOL: '1', LLM_LIVE: '1', LLM_ANBIETER_FIGUREN_NEBEN: 'ollama', LLM_ESKALATION_FIGUREN_NEBEN: '1' };
      for (const [name, zusatz, soll] of [['LLM_ESKALATION=aus', { LLM_ESKALATION: 'aus' }, null], ['LLM_ESKALATION_MODELL=haiku', { LLM_ESKALATION_MODELL: 'haiku' }, { anbieter: 'claude', modell: 'haiku' }], ['ohne Angabe', {}, { anbieter: 'claude', modell: 'sonnet' }]]) {
        Pool.zuruecksetzen(); erfasst = null;
        const llm = Pool.getLlm(ohneLage({ env: Object.assign({}, basis, zusatz) }).g);
        ok(erfasst && JSON.stringify(erfasst.eskalation) === JSON.stringify(soll) && llm.eskalationMoeglich('text', 'figuren_neben') === (soll !== null), `Text-Pool ${name}: Eskalation des Routers ${JSON.stringify(soll)}`);
      }
    } finally { Router.routeTransport = echt; Pool.zuruecksetzen(); }
    // stufeVon liest die Umgebung des Spiels: alle Slots auf figuren_haupt (der Standard waere geruechte_funk bzw. figuren_neben)
    const slots = ['ankuendigung', 'eintreffen', 'soeldner', 'verlust', 'dank', 'reaktion', 'antwort'];
    const d = datei({ format: 'spielleiter-stufen/1', stufen: {}, slots: Object.fromEntries(slots.map((s) => [s, 'figuren_haupt'])) });
    Pool.zuruecksetzen();
    const g = ohneLage({ env: { REISE_EREIGNISSE: '1', TEXTE_POOL: '1', LLM_LIVE: '1', STUFEN_DATEI: d } }).g;
    const stufen = [];
    const l = { mode: 'live', ask: async (k, i, o) => { stufen.push(o.stufe); return { text: JSON.stringify({ text: 'Fahrt weiter nach Nord, die Strasse ist frei.' }), tokens: 1, sec: 0.1 }; }, eskaliere: async () => { throw new Error('nie'); }, eskalationMoeglich: () => false };
    Pool.setLlm(l);
    Pool.beiGrenze(g); Pool.update(g, 0.1); await Pool.jobFertig();
    ok(stufen.length >= 1 && stufen.every((s) => s === 'figuren_haupt'), 'Text-Pool: die Stufe des Slots kommt aus der Umgebung des Spiels (STUFEN_DATEI), nicht aus process.env');
    Pool.zuruecksetzen();
  });

  // ---- (9) Eskalation bei einer Claude-Stufe: nicht still verworfen
  { const S1 = Stufen.lade({ LLM_ESKALATION_BAUPLAN: '1' });
    ok(S1.stufen.bauplan.eskalation === false && S1.fehler.some((f) => /bauplan.*eskalation/.test(f)), 'LLM_ESKALATION_BAUPLAN=1 bei einer Claude-Stufe: aus, mit Meldung');
    const S2 = Stufen.lade({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: { geruechte_funk: { anbieter: 'claude', eskalation: true } } }) });
    ok(S2.stufen.geruechte_funk.eskalation === false && S2.fehler.some((f) => /geruechte_funk.*eskalation/.test(f)), 'stufen.json: eskalation bei einer Claude-Stufe: aus, mit Meldung');
    const S3 = Stufen.lade({ LLM_ANBIETER_BAUPLAN: 'ollama', LLM_ESKALATION_BAUPLAN: '1' });
    ok(S3.stufen.bauplan.eskalation === true && S3.fehler.length === 0, 'bei einer Ollama-Stufe bleibt die Eskalation und es gibt keine Meldung'); }

  // ---- (10) jeder Eintrag wird einzeln geprueft, auch ohne Schema: kein TypeError, kein Abschalten der Lage-KI
  { const roh = { format: 'spielleiter-stufen/1', stufen: { bauplan: { anbieter: 'gpt' }, figuren_haupt: null, figuren_neben: 5, geruechte_funk: { anbieter: 'ollama', modell: 'a:1b' } }, slots: null };
    const ohneSchema = path.join(tmp, 'gibt-es-nicht.schema.json'), kaputtSchema = datei('{ kein schema');
    for (const [name, opt] of [['mit Schema', {}], ['Schema fehlt', { schemaDatei: ohneSchema }], ['Schema unlesbar', { schemaDatei: kaputtSchema }]]) {
      let S = null, wirft = null;
      try { S = Stufen.lade({ STUFEN_DATEI: datei(roh) }, opt); } catch (e) { wirft = e; }
      ok(!wirft && S && S.fehler.length >= 1 && S.stufen.bauplan.anbieter === 'claude' && S.stufen.figuren_haupt.anbieter === 'claude' && S.stufen.figuren_neben.quelle === 'standard', `Eintraege {"anbieter":"gpt"}, null und 5 (${name}): kein Wurf, Meldung, Standard fuer diese Stufen`);
      if (name !== 'mit Schema') ok(S.stufen.geruechte_funk.anbieter === 'ollama' && S.stufen.geruechte_funk.modell === 'a:1b', `(${name}) der gueltige Eintrag daneben gilt, die Pruefung je Eintrag entfaellt nicht`);
    }
    const textStufen = Stufen.lade({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: 'abc' }) }, { schemaDatei: ohneSchema });
    ok(textStufen.fehler.length === 1 && Stufen.abweichend(textStufen).length === 0, 'ohne Schema: ein Text statt eines Objekts bei stufen wird einmal gemeldet und nicht zeichenweise gelesen');
    const arrayDoc = Stufen.lade({ STUFEN_DATEI: datei('[1,2]') }, { schemaDatei: ohneSchema });
    ok(arrayDoc.fehler.length === 1 && Stufen.abweichend(arrayDoc).length === 0, 'ohne Schema: ein Array als Datei wird gemeldet, die Standardwerte gelten');
    const modellZahl = Stufen.lade({ STUFEN_DATEI: datei({ format: 'spielleiter-stufen/1', stufen: { geruechte_funk: { anbieter: 'ollama', modell: 7 } } }) }, { schemaDatei: ohneSchema });
    ok(modellZahl.fehler.length === 1 && modellZahl.stufen.geruechte_funk.modell === null && modellZahl.stufen.geruechte_funk.quelle === 'standard', 'ohne Schema: ein Modellname, der kein Text ist, wird gemeldet, der Standard gilt');
    let routerWirft = false; try { Router.routerAusEnv({ STUFEN_DATEI: datei(roh) }); } catch (e) { routerWirft = true; }
    ok(!routerWirft, 'der Router wirft bei diesen Eintraegen nicht'); }
});

section('Messwerkzeug tools/messe-abenteuer.js (Mock, ohne Netz)', () => {
  if (fails > 0) { console.log('  (uebersprungen: frueher gemeldete Fehler, das Werkzeug haengt sonst an der kaputten Kette)'); return; }
  const lauf3 = (args, env) => spawnSync(process.execPath, ['tools/messe-abenteuer.js', ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { LLM_LIVE: '', OLLAMA_URL: 'http://127.0.0.1:9' }, env || {}), timeout: 60000 });
  const r = lauf3(['--n', '40']);
  ok(r.status === 0 && /Aufrufe: 40/.test(r.stdout) && /gültig/.test(r.stdout) && /Ablehnquote/i.test(r.stdout) && /Wiederholung/i.test(r.stdout), 'Mock-Lauf: Gueltigkeit, Ablehnquote je Code, Wiederholungsrate');
  const g = /gültig (\d+) \(/.exec(r.stdout), a = /abgelehnt (\d+) \(/.exec(r.stdout);
  ok(g && a && Number(g[1]) + Number(a[1]) === 40, 'die Zaehlung geht auf (gueltig + abgelehnt = 40)');
  const live = lauf3(['--n', '5', '--live']);
  ok(live.status === 0 && /nicht gemessen/.test(live.stdout) && /LLM_LIVE=1/.test(live.stdout), '--live ohne LLM_LIVE=1: uebersprungen und ehrlich als nicht gemessen gemeldet');
  const oll = lauf3(['--n', '5', '--anbieter', 'ollama', '--modell', 'x:1b']);
  ok(oll.status === 0 && /nicht gemessen/.test(oll.stdout) && /Ollama/.test(oll.stdout), '--anbieter ollama ohne erreichbaren Dienst: uebersprungen und gemeldet');
  const M = require('./messe-abenteuer.js');
  ok(M.wiederholungen(['a', 'a', 'b', 'b', 'b', 'c']) === 3 && M.wiederholungen(['a', 'b', 'a']) === 0 && M.wiederholungen([]) === 0 && M.prozent(1, 4) === '25 %' && M.prozent(1, 0) === '–' && M.prozent(1, 3) === '33,3 %', 'Werkzeug: Wiederholungen (gleiche Typenfolge hintereinander) und Prozent von Hand gerechnet');
  ok(M.aufrufZahl('claude', 500) === 10 && M.aufrufZahl('claude') === 10 && M.aufrufZahl('ollama', 500) === 50 && M.aufrufZahl('ollama') === 10 && M.aufrufZahl('mock') === 200 && M.aufrufZahl('mock', 7) === 7, 'Werkzeug: hoechstens 10 echte Claude-Aufrufe, 50 bei Ollama, Mock Standard 200');
  const r2 = lauf3(['--n', '40']);
  const norm = (s) => s.replace(/Laufzeit [\d,.]+ s/, '').replace(/Median [\d,.]+ s, max [\d,.]+ s/, '');
  ok(norm(r2.stdout) === norm(r.stdout), 'der Mock-Lauf ist deterministisch (zwei Laeufe, gleiche Zahlen)');
  const x = lauf3(['--anbieter', 'gpt']);
  ok(x.status === 2 && /unbekannter Anbieter/i.test(x.stderr + x.stdout), 'unbekannter Anbieter: klare Fehlermeldung, Exit 2');
});

// ======================================================================
(async () => {
  for (const [name, fn] of abschnitte) {
    if (!gewaehlt(name)) continue;
    console.log('\n' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
  }
  LLM.resetBudget();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})();
