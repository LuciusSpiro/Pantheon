'use strict';
// SUND-04a-3: Mutationsprobe zu tools/test-finale.js und tools/test-finale-ws.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je
// Lauf EINE Regel und verlangt, dass ein Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, SyntaxError, Zeitüberschreitung, keine Prüfzeile) zählt NICHT
// als erkannt: er sagt nichts über die Regel. Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-finale.js [begriff …] [--trocken]      (npm run test:finale-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-finale-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TESTS = [['tools/test-finale.js'], ['tools/test-finale-ws.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const F = 'server/sim/finale.js', WK = 'server/weltsim/wirkungen.js', KL = 'server/sim/kriegslage.js', G = 'server/game.js', D = 'content/welt/finale-werte.json', P = 'shared/protocol.js';
const SIEG = "try { Kriegslage.szeneAbschliessen(game, { wirkungen: [{ typ: 'hauptwelt_erobert', ort: ZIEL.hex, an: ZIEL.an }], wo: 'finale' }); }";
const ABLEHNEN = "  s.angebot = 0; s.anfrage = null; s.frei_ab = tickZahl(game) + W.abstand_nach_ablehnen.wert;\n  return null;";
const NEUBEGINN = "  s.phase = null; s.anfrage = null; s.angebot = 0; s.frei_ab = tickZahl(game) + W.abstand_nach_scheitern.wert;\n  funkMeldung(game, key);";
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- die fünf Pflicht-Mutationen
  [F, "  if (!rangOk(game)) return { ok: false, grund: 'rang' };\n", "", 'Rang-Schwelle weg (bereit ohne Rang)'],
  [F, "  if (!anfrageRest(game)) { s.anfrage = null; return fehl('keine_anfrage'); }\n", "", 'Bestätigung weg (Start ohne Anfrage)'],
  [WK, "if (!kontext || !FINALE_PHASEN.includes(kontext.finale)) return 'kein laufendes Finale';", "if (false) return 'kein laufendes Finale';", 'Wirkung hauptwelt_erobert ohne Finale gültig'],
  [F, "  s.phase = 'boden';   // keine Sim-Wirkung, kein Tick: die Welt wartet bis zum Boden-Sieg\n", "  s.phase = 'boden';\n  require('./kriegslage.js').szeneAbschliessen(game, { wo: 'finale' });\n", 'Orbit-Ende löst einen Sim-Tick aus'],
  [F, "  if (ausgang === 'niederlage' || ausgang === 'flucht') { neubeginn(game, 'orbit_' + ausgang); return true; }", "  if (ausgang === 'niederlage' || ausgang === 'flucht') { neubeginn(game, 'orbit_' + ausgang); game.endGame({ title: 'Game Over' }); return true; }", 'Niederlage beendet das Spiel'],
  // ---- Zustandsmaschine und Befehle
  [F, "  if (ausgang === 'crew_gefallen') { neubeginn(game, 'crew_gefallen'); return true; }", "  if (ausgang === 'crew_gefallen') { neubeginn(game, 'crew_gefallen'); game.endGame({ title: 'Game Over' }); return true; }", 'gefallene Crew beendet das Spiel'],
  [F, "  if (!anfrageRest(game)) { s.anfrage = null; return fehl('keine_anfrage'); }", "  if (!s.anfrage) { return fehl('keine_anfrage'); }", 'Frist ignoriert (verfallene Anfrage gilt)'],
  [F, "  try { if (game.weltstand && typeof game.weltstand.fact === 'function') game.weltstand.fact('finale_gespielt', true, 'finale'); }", "  try { if (game.weltstand && typeof game.weltstand.fact === 'function') void 0; }", 'Fakt finale_gespielt wird nie gesetzt'],
  [F, "if (!a || !(a.bis > game.time)) return 0;", "if (!a) return 0;", 'Frist: Anfrage verfällt nie'],
  [F, "return rest <= f + 1e-9 ? Math.min(rest, f) : 0;", "return rest <= f ? rest : 0;", 'Frist: ohne Gleitkomma-Toleranz scheitert die Bestätigung im selben game.time'],
  [F, "return rest <= f + 1e-9 ? Math.min(rest, f) : 0;", "return rest <= f + 1e-9 ? rest : 0;", 'Frist: der Rest darf das Fenster nicht überschreiten (Anzeige 21 statt 20)'],
  [F, "  if (s.anfrage && !anfrageRest(game)) { s.anfrage = null; if (s.angebot) funkMeldung(game, 'angefragt_verfallen'); }\n", "", 'verfallene Anfrage wird nicht geräumt'],
  [F, "  if (rest) return fehl('schon_angefragt', { sek: Math.ceil(rest) });\n", "", 'zweite Anfrage in der Frist geht durch'],
  [F, "  if (!s.angebot) return fehl('kein_angebot');\n  const rest = anfrageRest(game);", "  const rest = anfrageRest(game);", 'Anfrage ohne Angebot'],
  [F, "  if (!starten(game)) { s.anfrage = null; return fehl('start'); }\n  return null;", "  starten(game);\n  return null;", 'misslungener Start wird als Erfolg gemeldet'],
  [F, "  if (!s || !bereit(game).ok) return false;\n  const angebot = s.angebot;", "  if (!s) return false;\n  const angebot = s.angebot;", 'starten prüft bereit nicht'],
  [F, "  const angebot = s.angebot;\n  s.phase = 'orbit'; s.angebot = 0; s.anfrage = null;", "  const angebot = s.angebot;\n  s.phase = 'orbit'; s.anfrage = null;", 'Angebot bleibt nach dem Start stehen'],
  [F, "if (!S) { s.phase = null; s.angebot = angebot; return false; }", "if (!S) { return false; }", 'Start ohne Szene bleibt in phase orbit'],
  [F, "  if (p) return fehl(p === 'ende' ? 'beendet' : 'laeuft');\n  if (!s.angebot) return fehl('kein_angebot');", "  if (!s.angebot) return fehl('kein_angebot');", 'Ablehnen mitten im Finale möglich'],
  [F, ABLEHNEN, "  s.angebot = 0; s.anfrage = null; s.frei_ab = tickZahl(game) + W.abstand_nach_ablehnen.wert; game.weltsim.ruf.rom = Math.max(0, game.weltsim.ruf.rom - 3);\n  return null;", 'Ablehnen kostet Ruf'],
  [F, ABLEHNEN, "  s.angebot = 0; s.anfrage = null;\n  return null;", 'Ablehnen ohne Pause'],
  [F, "  if (s.angebot && !rangOk(game)) { s.angebot = 0; s.anfrage = null; }", "", 'Angebot bleibt bei Rangverlust'],
  [F, NEUBEGINN + "\n  angebotSetzen(game);", NEUBEGINN, 'Neubeginn ohne neues Angebot'],
  [F, NEUBEGINN, NEUBEGINN.replace("s.phase = null;", "s.phase = 'ende';"), 'Neubeginn setzt phase auf ende'],
  [F, SIEG, "try { /* keine Wirkung */ }", 'Sieg bucht die Eroberung nicht'],
  [F, SIEG, SIEG.replace(" }); }", " }); Kriegslage.tick(game, 'finale'); }"), 'Sieg löst zwei Sim-Ticks aus'],
  [F, "  try { abspann().beenden(game, 'sieg'); }", "  try { /* kein Abspann */ }", 'Sieg ohne Abspann'],
  [F, "  try { abspann().beenden(game, 'sieg'); }", "  try { abspann().beenden(game, 'niederlage'); }", 'Abspann mit falscher Art'],
  [F, "  s.phase = 'ende'; s.angebot = 0; s.anfrage = null;\n  funkMeldung(game, 'sieg');", "  s.angebot = 0; s.anfrage = null;\n  funkMeldung(game, 'sieg');", 'Sieg setzt phase nicht auf ende'],
  [F, "  if (!s || s.phase !== 'orbit') return false;", "  if (!s) return false;", 'Orbit-Ende in jeder Phase gültig'],
  [F, "  if (!s || s.phase !== 'boden') return false;", "  if (!s) return false;", 'Boden-Ende in jeder Phase gültig'],
  [F, "  if (!ok) neubeginn(game, 'boden_nicht');", "", 'Boden nicht aufbaubar: Finale hängt in boden'],
  [F, "  if ((game.simSzene && game.simSzene.phase !== 'ende') || game.fadenSzene) return { ok: false, grund: 'szene' };", "  if (game.fadenSzene) return { ok: false, grund: 'szene' };", 'Start mitten in einer Sim-Szene'],
  [F, "  if ((game.simSzene && game.simSzene.phase !== 'ende') || game.fadenSzene) return { ok: false, grund: 'szene' };", "  if (game.simSzene && game.simSzene.phase !== 'ende') return { ok: false, grund: 'szene' };", 'Start mitten in einer Faden-Szene'],
  [F, "  if (p === 'ende') return { ok: false, grund: 'beendet' };\n", "", 'beendetes Finale lässt sich neu starten'],
  [F, "  if (!game.weltsim) return { ok: false, grund: 'modus' };\n  const p = phase(game);", "  const p = phase(game);", 'bereit ohne Modus-Prüfung'],
  [F, "  funkMeldung(game, 'anfrage', { sek: Math.round(f) });", "", 'keine Gefahrenankündigung bei der Anfrage'],
  [F, "  funkMeldung(game, 'angebot');\n  return true;", "  return true;", 'kein Funk beim Angebot'],
  [F, "  return [rangOk(game) ? 1 : 0, s.angebot ? 1 : 0, anfrageRest(game) ? 1 : 0, phase(game) || '-'].join('|');", "  return [rangOk(game) ? 1 : 0, s.angebot ? 1 : 0, phase(game) || '-'].join('|');", 'Änderungsschlüssel ohne Anfrage'],
  [F, "  if (anfrageRest(game)) b.anfrage = W.bestaetigung.wert.fenster;\n", "", 'Anzeige ohne Anfrage'],
  [F, "  return !!game.weltsim && (rangOk(game) || !!(s && (s.phase || s.angebot)));", "  return !!game.weltsim;", 'Block schon vor Tribun'],
  // ---- Welle 5 (M1): Funk des Kerns ist Meldung (Messing), nie Gefahr
  [F, "const funkMeldung = (game, key, vars) => OKFunk.meldung(game, T.sprecher, fmt((T.funk || {})[key], vars), { r: 1 });", "const funkMeldung = (game, key, vars) => OKFunk.gefahr(game, T.sprecher, fmt((T.funk || {})[key], vars), { r: 1 });", 'Funk des Kerns als Gefahr (Rot)'],
  ['server/sim/oberkommando-funk.js', "const meldung = (game, von, text, extra) => senden(game, TON.meldung, von, text, extra);", "const meldung = (game, von, text, extra) => senden(game, undefined, von, text, extra);", 'Meldung ohne ton (Client färbt Rot)'],
  // ---- Wirkung hauptwelt_erobert
  [WK, "      if (!alt || d.hauptwelten[alt] !== wk.ort) return 'Ort ist keine Hauptwelt';\n", "", 'hauptwelt_erobert: auch Nicht-Hauptwelten'],
  [WK, "      if (!feind(wk.an, alt)) return `${wk.an} ist nicht feindlich zu ${alt}`;\n      return null;\n    },\n    anwenden(c, wk) { H.erobern(c, wk.ort, wk.an); },", "      return null;\n    },\n    anwenden(c, wk) { H.erobern(c, wk.ort, wk.an); },", 'hauptwelt_erobert: eigene Hauptwelt erobern'],
  [WK, "      if (typeof wk.an !== 'string' || !['rom', 'ger', 'kon'].includes(wk.an)) return 'unbekannte Fraktion (an)';\n      if (!k.hafen)", "      if (!k.hafen)", 'hauptwelt_erobert: unbekannte Fraktion geht durch'],
  [WK, "const FINALE_PHASEN = ['orbit', 'boden'];", "const FINALE_PHASEN = ['orbit', 'boden', 'ende', null];", 'hauptwelt_erobert: auch nach dem Finale oder ohne Phase'],
  [WK, "    anwenden(c, wk) { H.erobern(c, wk.ort, wk.an); },", "    anwenden(c, wk) { c.z.hexe[wk.ort].besitzer = wk.an; },", 'hauptwelt_erobert: setzt nur den Besitzer (kein erobern, keine Ereignisse)'],
  [KL, "{ finale: Finale.phase(game) }));", "{ finale: 'boden' }));", 'Tick übergibt immer „Finale läuft“'],
  [KL, "  try { Finale.nachTick(game); } catch (e) { if (game.countError) game.countError('kriegslage-finale', e); }", "", 'Takt des Finales fehlt im Tick (kein Angebot)'],
  // ---- Server und Protokoll
  [G, "else if (!fnk && this.sentFinaleKey) { world.finale = null; this.sentFinaleKey = null; }", "else if (!fnk && this.sentFinaleKey) { this.sentFinaleKey = null; }", 'kein Löschsignal'],
  [G, "if (fnk && fnk !== this.sentFinaleKey && !includeAsteroids && !includeWorld && !includeLog && !includeBook)", "if (fnk && fnk !== this.sentFinaleKey)", 'Block auch in den großen Snapshots'],
  [G, "if (fnk && fnk !== this.sentFinaleKey && !includeAsteroids", "if (fnk && !includeAsteroids", 'Block in jedem Snapshot (nicht nur bei Änderung)'],
  [G, "loadout: 'transfer', finale: 'shop' };", "loadout: 'transfer', finale: 'helm' };", 'Befehl finale.* an der falschen Konsole'],
  [G, "op === 'bestaetigen' ? Finale.bestaetigen(this) : Finale.ablehnen(this);", "op === 'bestaetigen' ? Finale.waehlen(this) : Finale.ablehnen(this);", 'Bestätigen wirkt wie Anfragen'],
  [G, "if (p.conn) this.sendTo(p.conn, Object.assign({ t: 'event', kind: 'finaleAntwort', pid: p.id, op, ok: !r }", "if (false) this.sendTo(p.conn, Object.assign({ t: 'event', kind: 'finaleAntwort', pid: p.id, op, ok: !r }", 'keine Antwort an den Absender'],
  [P, "CMD_FINALE: ['finale.waehlen', 'finale.bestaetigen', 'finale.ablehnen'],", "CMD_FINALE: ['finale.waehlen', 'finale.bestaetigen', 'finale.ablehnen', 'finale.start'],", 'Protokoll: zusätzlicher Finale-Befehl'],
  // ---- Daten
  [D, '"mindestrang": {"wert": "tribun"', '"mindestrang": {"wert": "miles"', 'Daten: Mindestrang Miles'],
  [D, '"ziel": {"wert": {"hex": "1004"', '"ziel": {"wert": {"hex": "0204"', 'Daten: Ziel ist Palatina'],
  [D, '"fenster": 20}', '"fenster": 0}', 'Daten: Frist 0'],
  [D, 'ein harter Kampf. Ihr müsst nicht, und wer ablehnt, verliert nichts.', 'Ihr müsst jetzt kämpfen, sonst Abzug.', 'Text: Angebot droht mit Abzug und kündigt keine Gefahr an'],
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 300000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz (FEHLER Ausnahme, SyntaxError, Zeitüberschreitung, nur stderr) ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-finale.js, test-finale-ws.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  let wer = null, beleg = null, absturz = false;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fe = pruefFehler(r);
    if (fe.length) { wer = path.basename(t[0], '.js').replace('test-', ''); beleg = fe; break; }
    absturz = true;   // rot ohne Prüfzeile: Absturz, zählt nicht
  }
  fs.writeFileSync(f, orig);
  if (!wer) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${beleg.length} Fehler, z. B. ${beleg[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
