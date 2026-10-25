'use strict';
// SUND-04a-1 B: Mutationsprobe zu tools/test-faden-pruefer.js, test-faden-zustand.js, test-faden-spielleiter.js und test-faden-kompat.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis
// (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Ueberlebt eine Mutation, deckt kein Test die Regel ab.
// Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab, statt eine Mutation still zu ueberspringen.
//   node tools/mutation-faden.js [begriff ...] [--trocken]      (npm run test:faden-mutation)
// Bewusst nicht in der Liste (aequivalente Mutanten): „optionWaehlen prueft die Optionen noch einmal gegen den Katalog“ (die Vorlage ist beim Eintragen schon geprueft und eingefroren, die zweite Pruefung ist
// Guertel und Hosentraeger), „beatAusgang springt bei kaputtem Ziel zum Abschluss“ (der Pruefer laesst kein kaputtes Ziel zu), „Fehlerzaehler beim Laden (ladeFehler)“ (Meldung, keine Regel).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-pruefer.js'], ['tools/test-faden-zustand.js'], ['tools/test-faden-spielleiter.js'], ['tools/test-faden-kompat.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const PR = 'server/sim/faden-pruefer.js', FA = 'server/sim/faden.js', RB = 'server/sim/regie-befehle.js', RE = 'server/sim/reise-ereignis.js', GM = 'server/game.js', LA = 'server/sim/lage-ausschnitt.js',
  LP = 'server/sim/lage-prompt.js', LM = 'server/sim/lage-mock.js', KL = 'server/sim/kriegslage.js', WI = 'server/weltsim/wirkungen.js',
  DW = 'content/faeden/werte.json', DB = 'content/faeden/beats.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Pruefer der Vorlage
  [PR, "if (br.hinweis_vorher && !h) m('HINWEIS_FEHLT'", "if (false) m('HINWEIS_FEHLT'", 'Hinweis-Regel aus (Vorlage: vor der Enthuellung kein Hinweis noetig)'],
  [PR, "if (br.hinweis_vorher && !(f.hinweise && f.hinweise.length)) return fehl(", "if (false) return fehl(", 'Hinweis-Regel aus (Laufzeit: Enthuellung ohne gestreuten Hinweis)'],
  [PR, "if (v.wahrheit && !wahrheitBeat) fehler.push(", "if (false) fehler.push(", 'Wahrheit ohne Enthuellungs-Beat erlaubt'],
  [PR, "if (!v.wahrheit) fehler.push(fehl('ENTHUELLUNG_OHNE_WAHRHEIT'", "if (false) fehler.push(fehl('ENTHUELLUNG_OHNE_WAHRHEIT'", 'Enthuellung ohne verborgene Wahrheit erlaubt'],
  [PR, "if ((cat.abschluss || (cat.braucht && cat.braucht.letzter)) && i !== last) fehler.push(", "if (false) fehler.push(", 'Abschluss muss nicht der letzte Beat sein'],
  [PR, "if (braucht.fluchtziel && !fluchtzielOk(p.fluchtziel)) out.push(", "if (false) out.push(", 'Verfolgung ohne Fluchtziel erlaubt'],
  [PR, "if (aus.gescheitert.status === aus.gelungen.status && nach(aus.gescheitert) === nach(aus.gelungen)) fehler.push(", "if (false) fehler.push(", 'Scheitern darf folgenlos sein'],
  [PR, "if (br.nsc_status && !br.nsc_status.includes(s)) m('STATUS_PASST_NICHT'", "if (false) m('STATUS_PASST_NICHT'", 'Beat laeuft mit jedem Zustand des NSC (Wege werden nicht geprueft)'],
  [PR, "if (s === 'tot' && o.status !== 'tot') m('TOT_BLEIBT_TOT'", "if (false) m('TOT_BLEIBT_TOT'", 'ein toter NSC darf wieder lebendig werden (Vorlage)'],
  [PR, "else if (z <= i) fehler.push(", "else if (false) fehler.push(", 'weiter darf zurueckspringen (Endlosschleife moeglich)'],
  [PR, "if (!erreicht.has(i)) fehler.push(", "if (false) fehler.push(", 'unerreichbare Beats erlaubt'],
  [PR, "if (b.gefahr === false && cat.gefahr) fehler.push(", "if (false) fehler.push(", 'die Vorlage darf Gefahr abschwaechen'],
  [PR, "if (wirksamGefahr(beat, cat)) { out.push(", "if (false) { out.push(", 'Optionen bei Gefahr erlaubt'],
  [PR, "if (cat.optionen !== 'erlaubt') { out.push(", "if (false) { out.push(", 'Optionen bei einem Beat ohne Optionen erlaubt'],
  [PR, "if (profile[a].p && profile[a].p === profile[b].p) out.push(", "if (false) out.push(", 'Scheinwahl: gleiche Folge zweier Optionen erlaubt'],
  [PR, "if (folgenlos > 1) out.push(", "if (false) out.push(", 'Scheinwahl: mehrere folgenlose Optionen erlaubt'],
  [PR, "if (!(a.min >= W.abstand.min && a.max <= W.abstand.max && a.min <= a.max)) fehler.push(", "if (false) fehler.push(", 'Abstand der Vorlage darf den Bereich erweitern'],
  // ---- Pruefer der Befehle
  [PR, "if (aktive(F).length + ctx.oeffnen >= W.aktiv_max) return fehl(", "if (false) return fehl(", 'Obergrenze aus (mehr als 3 aktive Faeden)'],
  [PR, "if (f.zaehler < f.abstand) return fehl(", "if (false) return fehl(", 'Abstand aus (Beat vor 2 bis 4 Taetigkeiten)'],
  [PR, "if (b.beat !== beat.id) return fehl('REIHENFOLGE'", "if (false) return fehl('REIHENFOLGE'", 'Reihenfolge der Beats nicht erzwungen'],
  [PR, "if (f.phase === 'laeuft') return fehl('FADEN_BELEGT'", "if (false) return fehl('FADEN_BELEGT'", 'zweiter Beat waehrend einer laeuft'],
  [PR, "if (f.phase === 'abgeschlossen') return fehl('FADEN_ABGESCHLOSSEN'", "if (false) return fehl('FADEN_ABGESCHLOSSEN'", 'abgeschlossener Faden geht weiter'],
  [PR, "if (!nameOk(p.name, volk)) return fehl('NAME'", "if (false) return fehl('NAME'", 'NSC-Name frei waehlbar (nicht nur aus den Listen)'],
  [PR, "if (ctx.n >= W.befehle_je_plan_max) return fehl(", "if (false) return fehl(", 'beliebig viele Faden-Befehle je Plan'],
  [PR, "if (!a) return fehl('KEIN_ANGEBOT', `kein offenes Angebot", "if (false) return fehl('KEIN_ANGEBOT', `kein offenes Angebot", 'Faden ohne Taetigkeit mit Person (ohne Angebot)'],
  // ---- Zustand und Ablauf
  [FA, "  if (cat.abschluss) {\n    f.phase = 'abgeschlossen';", "  if (cat.abschluss || ausgang === 'gescheitert') {\n    f.phase = 'abgeschlossen';", 'Scheitern beendet den Faden'],
  [FA, "f.zaehler = Math.min(f.zaehler + 1, ZAEHLER_MAX);", "f.zaehler = f.zaehler;", 'Zaehler des Fadens laeuft nicht'],
  [FA, "F.t = Math.min(F.t + 1, 1e9);", "F.t = (game.weltsim.chronik || []).length;", 'Taetigkeiten werden ueber die Chronik gezaehlt'],
  [FA, "if (!aktiv(game) || !W.taetigkeiten.includes(art)) return null;", "if (!aktiv(game)) return null;", 'jede Art von Grenze zaehlt als Taetigkeit'],
  [FA, "if (f.phase === 'laeuft' && f.laufend && f.laufend.n >= W.beat_frist) {", "if (false) {", 'Frist aus (ein Beat ohne Ausgang blockiert den Faden)'],
  [FA, "return lo + Math.min(hi - lo, Math.floor(r * (hi - lo + 1)));", "return lo;", 'Abstand wird nicht gezogen (immer der kleinste)'],
  [FA, "if (o.status && f.nsc.status !== 'tot') f.nsc.status = o.status;", "if (o.status) f.nsc.status = o.status;", 'ein toter NSC wird wieder lebendig (Ablauf)'],
  [FA, "while (nsc.gedaechtnis.length > W.gedaechtnis_max) nsc.gedaechtnis.shift();", "", 'Gedaechtnis waechst ohne Grenze'],
  [FA, "const klemmen = (x) => r2(Math.min(H.grenzen.max, Math.max(H.grenzen.min, Number.isFinite(x) ? x : 0)));", "const klemmen = (x) => r2(Number.isFinite(x) ? x : 0);", 'Haltung wird nicht geklemmt'],
  [FA, "return r2(y0 + (y1 - y0) * ((h - x0) / (x1 - x0)));", "return y1;", 'Kurve der Spontanhilfe springt statt zu interpolieren'],
  [FA, "if (!nscVon(game, w.npc)) return { ok: false, grund: 'unbekannter NSC (npc): er steht in keinem Faden' };", "", 'Haltung fuer einen NSC, den es nicht gibt'],
  [FA, "return v === '1' || v === 'on';", "return true;", 'Schalter immer an'],
  [FA, "if (aktive(F).length >= W.aktiv_max) return null;   // kein Platz", "if (false) return null;", 'Angebot trotz voller Obergrenze'],
  [FA, "if (f.laufend.gewaehlt) return { ok: false, grund: 'schon gewählt' };", "", 'Option mehrfach waehlbar'],
  [FA, "for (const h of beat.hinweise || []) if (!f.hinweise.includes(h)) f.hinweise.push(h);", "", 'Hinweise des Beats werden nicht gestreut'],
  [FA, "if (cat.braucht && cat.braucht.wahrheit && f.nsc.wahrheit) f.nsc.wahrheit.offenbart = true;", "", 'Enthuellung setzt die Wahrheit nicht'],
  [FA, "if (r.faden.phase !== 'abgeschlossen' && aktive(F).length >= W.aktiv_max) {", "if (false) {", 'Leser klemmt die Obergrenze nicht'],
  [FA, "const e = P.pruefeFaden(f);\n  return e.length ?", "const e = [];\n  return e.length ?", 'Leser prueft den Faden nicht'],
  // ---- Anbindung
  [KL, "const fb = Faden.toSave(ws); if (fb) b.faeden = fb;", "", 'Faeden werden nicht gespeichert'],
  [KL, "game.weltsim.faeden = Faden.lesen(b.faeden);", "game.weltsim.faeden = Faden.neu();", 'Faeden werden nicht geladen'],
  [KL, "if (fadenSicher && gueltig.some((w) => w.typ === 'haltung_aenderung')) Faden.anwenden(game, gueltig);", "", 'haltung_aenderung wird im Tick nicht angewandt'],
  [KL, "if (fadenSicher) ws.faeden.liste = fadenSicher;", "", 'Haltung geht beim Wurf des Ticks nicht auf die Sicherung zurueck'],
  [GM, "try { require('./sim/faden.js').taetigkeit(this, art); }", "try { /* aus */ }", 'Taetigkeitsgrenzen zaehlen nicht (Hook in game.lageGrenze)'],
  [RE, "function notrufMitPerson(game, e, ev) {\n  try {", "function notrufMitPerson(game, e, ev) {\n  return;\n  try {", 'bewaeltigter Notruf macht kein Angebot (Hook in reise-ereignis.js)'],
  [RB, "return F.aktiv(game) ? F : null; } catch (e) { return null; } };", "return F; } catch (e) { return null; } };", 'Faden-Befehle ohne Schalter gueltig (nicht byte-gleich zu main)'],
  [RB, "if (g) out.abgelehnt.push({ befehl: b, grund: g }); else fadenAngenommen.push(", "if (g) { /* verschluckt */ } else fadenAngenommen.push(", 'abgelehnte Faden-Befehle verschwinden ohne Logbuch'],
  [LA, "const fb = fadenBlock(game); if (fb) b.faeden = fb;", "", 'kein Faden-Block im Ausschnitt'],
  [LP, "return F.aktiv(game) ? F.promptText() : ''; }", "return F.promptText(); }", 'Faden-Text im Prompt auch ohne Schalter'],
  [FA, "  const block = { aktiv: fa, platz: Math.max(0, W.aktiv_max - fa.length) };", "  const block = { aktiv: fa.map((x) => Object.assign(x, { nsc: Object.assign(x.nsc, { name: liste[fa.indexOf(x)].nsc.name }) })), platz: Math.max(0, W.aktiv_max - fa.length) };", 'NSC-Namen im Prompt-Block'],
  [FA, "while (zu() && block.aktiv.length > 1) block.aktiv.pop();", "", 'Faden-Block wird nicht gekuerzt'],
  [LM, "x.ph === 'wartet' && x.faellig === 1", "x.ph === 'wartet'", 'Mock stellt Beats vor der Faelligkeit'],
  // ---- Wirkung haltung_aenderung
  [WI, "if (Math.sign(wk.delta) !== Math.sign(q) || Math.abs(wk.delta) > Math.abs(q)) return", "if (false) return", 'haltung_aenderung: Vorzeichen und Betrag nicht gegen den Grund geprueft'],
  [WI, "if (typeof wk.npc !== 'string' || !/^n[0-9]{1,6}$/.test(wk.npc)) return", "if (false) return", 'haltung_aenderung: npc nicht geprueft'],
  // ---- Daten
  [DW, '"aktiv_max": {"wert": 3,', '"aktiv_max": {"wert": 4,', 'Daten: Obergrenze 4 statt 3'],
  [DW, '"abstand": {"wert": {"min": 2, "max": 4}', '"abstand": {"wert": {"min": 1, "max": 4}', 'Daten: Abstand ab 1 statt 2'],
  [DW, '"abstand": {"wert": {"min": 2, "max": 4}', '"abstand": {"wert": {"min": 2, "max": 6}', 'Daten: Abstand bis 6 statt 4'],
  [DB, '"baustein": "spontanhilfe",\n      "gefahr": true,', '"baustein": "spontanhilfe",\n      "gefahr": false,', 'Daten: Spontanhilfe bringt keine Gefahr mehr (Optionen waeren erlaubt)'],
  [DB, '"braucht": {"nsc_status": ["aktiv", "verbuendet"], "wahrheit": true, "hinweis_vorher": true}', '"braucht": {"nsc_status": ["aktiv", "verbuendet"], "wahrheit": true}', 'Daten: Enthuellung braucht keinen Hinweis davor'],
];

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
console.log(`Mutationsprobe test-faden-pruefer.js, test-faden-zustand.js, test-faden-spielleiter.js, test-faden-kompat.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
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
  console.log(`  ${wer ? 'rot  ' : 'GRUEN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- UEBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) ueberlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
