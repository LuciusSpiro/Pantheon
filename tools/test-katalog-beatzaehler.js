'use strict';
// KAT-01 B: Waechter fuer das Kontextfeld beat_zaehler (abenteuer-prompt.js kontextVon, beatZaehler) und seine Regelzeile im Katalog – npm run test:katalog-beatzaehler.
// Offline, kein Claude-Aufruf. Das Feld zaehlt, wie oft jeder Beat-Typ in den Typenfolgen von letzte_abenteuer vorkam (genau die Liste, die im selben Kontext steht, also nach Brett-Quelle und Entdopplung; hoechstens drei Folgen).
//   a Zaehler stimmt fuer eine konstruierte Folge (von Hand gerechnet, nicht aus dem Erzeuger abgeleitet); nur Zahlen, sortiert, nie Namen/Titel
//   b leere letzte_abenteuer -> {}
//   c abschluss steht nie im Zaehler; nur Typen mit Zahl groesser 0
//   d Absichten-Modus (baueAbsicht): Kontext und Prompt enthalten das Feld nicht
//   e Katalogwachstum aller KAT-01-Zeilen (Katalog minus Katalog ohne sie, katalogTextOhneKat) hoechstens 800 (plus Zuschlag je Probe-Beat im Speicher, ohne Probe-Beats 0), ohne absolute Basis (neue Beats kippen die Pruefung nicht; Basis ohne Probe-Beats war 11 945); die beiden Zeilen hoechstens 400 Zeichen
//   f Wirkung am Produktcode: Katalog mit Zeile enthaelt sie, mit abgeschaltetem Feature (katalogTextOhneKat) nicht; Mutationen am QUELLTEXT von abenteuer-prompt.js (beatZaehler, kontextVon, als eigene Modulkopie geladen) machen sowohl die Zaehlerpruefung als auch den Kontext-Aufbau rot
//   g Prompt in allen vier Profilen hoechstens 15 350 Zeichen (Mock, tools/messe-abenteuer.js --out ausserhalb des Repos) UND der Kontext wurde nicht gekuerzt (kontextZeichen aus baue() = Laenge des Kontext-JSON bei Stufe 0, im selben Spielstand je Profil nachgebaut)
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));

const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const D = require('../server/sim/faden-daten.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const Abs = require('../server/sim/absicht-pruefer.js');

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const WACHSTUM_BASIS = 800, PROMPT_MAX = 15350;

// Zuschlag je Beat, den die Daten im Speicher mehr haben als beats.json (Probe-Beats, PROBE_BEATS): sein Name steht hoechstens dreimal samt Trenner in den Listen der Zeile; ohne Probe-Beats ist der Zuschlag 0
const dateiBeats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'beats.json'), 'utf8')).beats;
const ZUSCHLAG = Object.keys(D.BEATS).filter((k) => !(k in dateiBeats)).reduce((s, k) => s + 3 * (k.length + 3), 0);
const WACHSTUM_MAX = WACHSTUM_BASIS + ZUSCHLAG;

const t = X.F.neuesSpiel({ crew: 3, seed: 11, names: ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'], env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
const g = t.g;
g.lageSpielleiter = LS.create(g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
g.lageSchalter = true;
const W = AP.WERTE;
const kontext = (letzte, mod) => (mod || AP).kontextVon(g, W, letzte, 0, '0305');

// Pruefung des Zaehlers gegen eine von Hand gerechnete Erwartung; leere Liste = stimmig. zaehl ist austauschbar (Mutationsprobe).
const LETZTE = [{ nr: 1, typen: ['landung', 'wrack', 'rettung', 'abschluss'] }, { nr: 2, typen: ['landung', 'verfolgung', 'verfolgung', 'abschluss'] }, { nr: 3, typen: ['landung', 'wrack', 'spur', 'abschluss'] }];
const ERWARTET = { landung: 3, rettung: 1, spur: 1, verfolgung: 2, wrack: 2 };
function zaehlerProbleme(zaehl) {
  const P = [];
  const z = zaehl(LETZTE.map((x) => x.typen));
  if (JSON.stringify(z) !== JSON.stringify(ERWARTET)) P.push('Zaehler ' + JSON.stringify(z));
  if (Object.keys(z).includes('abschluss')) P.push('abschluss im Zaehler');
  if (Object.values(z).some((v) => !Number.isInteger(v) || v <= 0)) P.push('Wert keine positive Zahl');
  if (JSON.stringify(zaehl([])) !== '{}') P.push('leer nicht {}');
  return P;
}
// Pruefung des Kontext-Aufbaus (kontextVon eines Moduls): das Feld im Kontext ist der Zaehler der Liste letzte_abenteuer im selben Kontext
function kontextProbleme(mod) {
  const P = [];
  let k;
  try { k = kontext(LETZTE, mod); } catch (e) { return ['kontextVon wirft: ' + e.message]; }
  if (JSON.stringify(k.beat_zaehler) !== JSON.stringify(ERWARTET)) P.push('beat_zaehler im Kontext ' + JSON.stringify(k.beat_zaehler));
  if (JSON.stringify(k.letzte_abenteuer) !== JSON.stringify(LETZTE.map((x) => x.typen))) P.push('letzte_abenteuer ' + JSON.stringify(k.letzte_abenteuer));
  return P;
}

// ---------- a bis c
const kA = kontext(LETZTE);
check('a Kontext letzte_abenteuer ist die Liste der drei Folgen (Brett-Quelle leer im frischen Spiel)', JSON.stringify(kA.letzte_abenteuer) === JSON.stringify(LETZTE.map((x) => x.typen)), JSON.stringify(kA.letzte_abenteuer));
check('a beat_zaehler im Kontext: landung 3, wrack 2, rettung 1, spur 1, verfolgung 2 (zweimal in einer Folge); Schluessel sortiert', JSON.stringify(kA.beat_zaehler) === JSON.stringify(ERWARTET), JSON.stringify(kA.beat_zaehler));
check('a Zaehler stammt aus genau der Liste letzte_abenteuer (gleiche Folge zaehlt nach der Entdopplung einmal)', (() => { const k = kontext(LETZTE.concat([{ nr: 4, typen: LETZTE[0].typen }])); return JSON.stringify(k.beat_zaehler) === JSON.stringify(AP.beatZaehler(k.letzte_abenteuer)) && k.beat_zaehler.landung === 3; })());
check('a nur Zahlen, nie Namen oder Titel', Object.values(kA.beat_zaehler).every((v) => typeof v === 'number') && !/Mireille|Ouzo|Tzvi/.test(JSON.stringify(kA)));
check('a nur Beat-Typen der Daten', Object.keys(kA.beat_zaehler).every((k) => !!D.BEATS[k]));
check('a erscheint im Prompt von baue()', (() => { const b = AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: LETZTE }); return !b.fehler && b.prompt.includes('"beat_zaehler":{"landung":3,"rettung":1,"spur":1,"verfolgung":2,"wrack":2}'); })());
check('b leere letzte_abenteuer -> beat_zaehler {}', JSON.stringify(kontext([]).beat_zaehler) === '{}' && JSON.stringify(kontext([]).letzte_abenteuer) === '[]');
check('c abschluss nie im Zaehler, auch wenn eine Folge ihn enthaelt', !('abschluss' in kA.beat_zaehler) && !('abschluss' in AP.beatZaehler([['abschluss', 'landung']])));
check('c nur Typen mit Zahl groesser 0 (unbekannter Typ zaehlt nicht)', JSON.stringify(AP.beatZaehler([['landung', 'zz_gibtsnicht']])) === '{"landung":1}');
check('a-c Zaehlerpruefung und Kontext-Aufbau: keine Probleme mit dem echten Code', zaehlerProbleme(AP.beatZaehler).length === 0 && kontextProbleme(null).length === 0, zaehlerProbleme(AP.beatZaehler).concat(kontextProbleme(null)).join(' / '));

// ---------- d Absichten-Modus
{
  const bau = AP.baueAbsicht(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: W, katalog: Abs.katalogStandard() });
  const k = bau.fehler ? {} : JSON.parse(/<kontext>\n([\s\S]*?)\n<\/kontext>/.exec(bau.prompt)[1]);
  check('d Absichten-Prompt: kein beat_zaehler im Kontext, Kontext-Schluessel unveraendert', !bau.fehler && !('beat_zaehler' in k) && Object.keys(k).sort().join() === 'chronik,crew,crew_geschichte,lage,laufend,letzte_absichten,ruf,tick,wendepunkte', Object.keys(k).join());
  check('d Absichten-Prompt nennt beat_zaehler nirgends (auch nicht im Katalog)', !bau.fehler && !/beat_zaehler/.test(bau.prompt));
}

// ---------- e Katalog
const text = AP.katalogText();
const zeile = text.split('\n').find((l) => l.startsWith('Kontext beat_zaehler:'));
check('e Regelzeile steht im Katalog, genau einmal, mit dem Wortlaut (nur Hinweis, nichts gesperrt)', !!zeile && text.split('beat_zaehler').length === 2 && zeile === 'Kontext beat_zaehler: Zahl je Beat-Typ in letzte_abenteuer (nur Zahlen). Meide Typen mit hohem Zaehler, nimm lieber seltene oder fehlende.', zeile);
const hinweis = text.split('\n').find((l) => l.startsWith('Landeplatz-Beats ('));
const lbNamen = (D0) => Object.keys(D0).filter((t) => D0[t].braucht && D0[t].braucht.landeplatz === true);
check('e Landeplatz-Hinweis steht genau einmal, nennt genau die Beats mit braucht.landeplatz aus den Daten, ist Hinweis ohne Sperre; die Satzteile "Szenen am Boden, nicht in jedem Abenteuer noetig", "kam einer ... meist ohne aus", "Mehrere ... Geschichte" stehen darin', !!hinweis && text.split('Landeplatz-Beats (').length === 2 && hinweis.includes('(' + lbNamen(D.BEATS).join(' | ') + ')') && lbNamen(D.BEATS).length > 0 && /Szenen am Boden, nicht in jedem Abenteuer noetig/.test(hinweis) && /kam einer in letzte_abenteuer vor, kommt das naechste meist ohne aus/.test(hinweis) && /Mehrere[^.]*wenn die Geschichte es traegt/.test(hinweis) && !/nie |verboten|hoechstens|gesperrt/.test(hinweis), hinweis);
check('e Zaehlerzeile + Landeplatz-Hinweis zusammen hoechstens 400 Zeichen', !!zeile && !!hinweis && zeile.length + hinweis.length <= 400, zeile && hinweis && (zeile.length + hinweis.length));
const wachstum = text.length - AP.katalogTextOhneKat().length;
check(`e Wachstum aller KAT-01-Zeilen (Katalog minus Katalog ohne sie) hoechstens ${WACHSTUM_MAX} Zeichen`, wachstum > 0 && wachstum <= WACHSTUM_MAX, `Wachstum ${wachstum}`);
check('e kein Befehlston gegen einzelne Beats: die Zeile nennt keinen Beat-Typ', !!zeile && !Object.keys(D.BEATS).some((b) => new RegExp('\\b' + b + '\\b').test(zeile.replace('beat_zaehler', ''))));

// ---------- f Wirkung am Produktcode
{
  const ohne = AP.katalogTextOhneKat();
  check('f Produktcode: der Katalog mit Feature enthaelt die Regelzeile und den Landeplatz-Hinweis, der mit abgeschaltetem Feature (katalogTextOhneKat) keine von beiden und kein beat_zaehler; der Cache bleibt unberuehrt', !!zeile && !!hinweis && !ohne.includes('beat_zaehler') && !ohne.includes('Landeplatz-Beats (') && AP.katalogText() === text);
  // Mutationen am Quelltext: eine Kopie des Moduls mit veraenderter Funktion laden (dieselben Daten und Abhaengigkeiten aus dem Cache)
  const datei = require.resolve('../server/sim/abenteuer-prompt.js');
  const quelle = fs.readFileSync(datei, 'utf8').replace(/\r\n/g, '\n');
  const laden = (ersetze) => {
    const neu = ersetze ? ersetze(quelle) : quelle;
    if (ersetze && neu === quelle) throw new Error('Mutation trifft den Quelltext nicht');
    const m = new Module(datei, module); m.filename = datei; m.paths = Module._nodeModulePaths(path.dirname(datei)); m._compile(neu, datei);
    return m.exports;
  };
  const ersetze = (a, b) => (s) => { if (!s.includes(a)) throw new Error('Quelltext aendert sich: ' + a); return s.replace(a, () => b); };
  const kopie = laden(null);
  check('f Modulkopie ohne Mutation verhaelt sich wie das Original (Zaehlerpruefung und Kontext-Aufbau gruen)', zaehlerProbleme(kopie.beatZaehler).length === 0 && kontextProbleme(kopie).length === 0, zaehlerProbleme(kopie.beatZaehler).concat(kontextProbleme(kopie)).join(' / '));
  const mutationen = {
    'beatZaehler zaehlt abschluss mit': { s: ersetze('if (B[t] && !B[t].abschluss) z[t]', 'if (B[t]) z[t]'), zaehler: true, kontext: true },
    'beatZaehler zaehlt jede Folge nur einmal je Typ': { s: ersetze('for (const t of f || [])', 'for (const t of new Set(f || []))'), zaehler: true, kontext: true },
    'beatZaehler unsortiert (umgekehrt)': { s: ersetze('Object.keys(z).sort()', 'Object.keys(z).reverse()'), zaehler: true, kontext: true },
    'kontextVon zaehlt eine leere Liste': { s: ersetze('beat_zaehler: beatZaehler(letzte_abenteuer)', 'beat_zaehler: beatZaehler([])'), zaehler: false, kontext: true },
    'kontextVon zaehlt nur die letzte Folge': { s: ersetze('beat_zaehler: beatZaehler(letzte_abenteuer)', 'beat_zaehler: beatZaehler(letzte_abenteuer.slice(-1))'), zaehler: false, kontext: true },
  };
  for (const [name, m] of Object.entries(mutationen)) {
    const mod = laden(m.s);
    const zp = zaehlerProbleme(mod.beatZaehler), kp = kontextProbleme(mod);
    check(`f Mutation am Quelltext "${name}": Zaehlerpruefung ${m.zaehler ? 'rot' : 'gruen (die Funktion ist richtig)'}, Kontext-Aufbau rot`, (zp.length > 0) === m.zaehler && (kp.length > 0) === m.kontext, `zaehler ${zp.length}, kontext ${kp.length}`);
  }
  // Mutation in Speicher: ein erfundener Beat mit braucht.landeplatz muss im Text auftauchen (Namen kommen aus den Daten, nichts hart codiert)
  {
    const zusatz = 'erfundener_boden_beat';
    const orig = D.BEATS[zusatz];
    const vorlage = D.BEATS[lbNamen(D.BEATS)[0]];
    D.BEATS[zusatz] = Object.assign({}, vorlage, { braucht: Object.assign({}, vorlage.braucht, { landeplatz: true }) });
    let neu = '';
    try { AP.katalogNeuLesen(); neu = AP.katalogText() || ''; } catch (e) { neu = 'FEHLER ' + e.message; }
    if (orig === undefined) delete D.BEATS[zusatz];
    AP.katalogNeuLesen();
    const h2 = neu.split('\n').find((l) => l.startsWith('Landeplatz-Beats ('));
    check('f Mutation: ein erfundener Beat mit braucht.landeplatz taucht im Hinweis auf (Namen aus den Daten)', !!h2 && h2.includes(zusatz), h2 || neu.slice(0, 80));
    check('f danach ist der Katalog wieder der alte', AP.katalogText() === text);
  }
}

// ---------- g Prompt in den vier Profilen (Mock)
{
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'katbz-'));
  const dir = path.join(__dirname, 'fixtures', 'messe', 'profile');
  const profile = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  check('g vier Profile vorhanden', profile.length === 4, profile.join());
  for (const p of profile) {
    const out = path.join(ordner, p);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'messe-abenteuer.js'), '--n', '2', '--profil', path.join(dir, p), '--out', out], { encoding: 'utf8', env: Object.assign({}, process.env, { LLM_LIVE: '' }) });
    const lauf = fs.existsSync(out) ? fs.readdirSync(out).map((d) => path.join(out, d)) : [];
    const laengen = lauf.flatMap((d) => fs.readdirSync(d).filter((f) => /\.prompt\.txt$/.test(f)).map((f) => fs.readFileSync(path.join(d, f), 'utf8').length));
    const max = Math.max(0, ...laengen);
    check(`g Profil ${p}: Prompt hoechstens ${PROMPT_MAX} Zeichen (Maximum ${max}, ${laengen.length} Prompts)`, r.status === 0 && laengen.length >= 2 && max <= PROMPT_MAX, (r.stderr || '').slice(0, 120));
  }
  try { fs.rmSync(ordner, { recursive: true, force: true }); } catch (e) { /* egal */ }
  // Kontext nicht gekuerzt: baue() kuerzt erst, wenn der volle Prompt die Obergrenze (prompt_max_zeichen) reisst; ein gekuerzter Kontext koennte den Prompt unter 15 350 druecken und das Wachstum verstecken
  const Profil = require('./messe-profil.js');
  const F2 = require('./regie-fixture.js');
  const Faden = require('../server/sim/faden.js');
  const MA = require('./messe-absichten.js');
  const vorgeschichte = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'messe', 'vorgeschichte.json'), 'utf8'));
  for (const p of profile) {
    const profil = Profil.profilLesen(path.join(dir, p), process.cwd());
    const sp = F2.neuesSpiel({ crew: 1, seed: 7, names: ['Messung'], env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } });
    const g2 = sp.g;
    for (let i = 0; i < 6; i++) g2.step();
    if (profil.vorgeschichte) MA.vorgeschichteAufbauen(g2, Faden, D, vorgeschichte);
    Profil.anwenden(g2, profil, { Kriegslage: require('../server/sim/kriegslage.js'), Chronik: require('../server/sim/chronik.js'), Ruf: require('../server/sim/ruf.js'), Sektoren: require('../shared/sektoren.js') });
    g2.lageSpielleiter = LS.create(g2, { llm: LLM.create({ mode: 'mock' }), abenteuerWerte: { deckel_je_sitzung: 1e9, cooldown_grenzen: 0 } });
    g2.lageSchalter = true;
    const hex = Profil.zielFuer(profil, 0) || profil.crew_hex || '0305';
    const bau = AP.baue(g2, { nr: 1, grenze: 'andocken', hex, letzte: LETZTE, geschichte: false });
    const voll = JSON.stringify(AP.kontextVon(g2, W, LETZTE, 0, hex, false)).length;
    check(`g Profil ${p}: Kontext nicht gekuerzt (kontextZeichen ${bau.kontextZeichen} = Laenge des Kontext-JSON bei Stufe 0 ${voll}), Prompt ${bau.zeichen} <= ${PROMPT_MAX}`, !bau.fehler && bau.kontextZeichen === voll && bau.zeichen <= PROMPT_MAX, JSON.stringify({ fehler: bau.fehler, kz: bau.kontextZeichen, voll }));
    g2.lageSpielleiter.dispose && g2.lageSpielleiter.dispose();
  }
}

const fail = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok    ' : 'FEHLER'} ${r.name}${!r.ok && r.detail !== undefined ? '  [' + r.detail + ']' : ''}`);
console.log(`\n${results.length - fail.length}/${results.length} Pruefungen bestanden`);
process.exit(fail.length ? 1 : 0);
