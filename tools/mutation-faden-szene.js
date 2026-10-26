'use strict';
// SUND-04a-2 P1: Mutationsprobe zu tools/test-faden-szene.js (und test-faden-zustand.js). Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis
// (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Ueberlebt eine Mutation, deckt kein Test die Regel ab.
// Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab, statt eine Mutation still zu ueberspringen.
// Abstuerze (Syntaxfehler, Ausnahmen ohne FEHLER-Zeile) zaehlen NICHT als erkannt.
//   node tools/mutation-faden-szene.js [begriff ...] [--trocken]      (npm run test:faden-szene-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-szene-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-szene.js'], ['tools/test-faden-zustand.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const SZ = 'server/sim/faden-szene.js', FR = 'server/sim/faden-fracht.js', FA = 'server/sim/faden.js', GM = 'server/game.js', RE = 'server/sim/reise-ereignis.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [SZ, 'const frei = (game) => !game.simSzene && !game.fadenSzene', 'const frei = (game) => !game.fadenSzene', 'Szene startet bei laufender Sim-Szene'],
  [SZ, '  else if (game.simSzene && game.fadenSzene) unterbrechen(game, game.fadenSzene);', '  else if (false) unterbrechen(game, game.fadenSzene);', 'Sim-Szene unterbricht die Faden-Szene nicht'],
  [SZ, '  Faden.beatZurueck(game, fs.fadenId);\n  funk(game, T.unterbrochen);', "  Faden.beatAusgang(game, fs.fadenId, 'gescheitert');\n  funk(game, T.unterbrochen);", 'Unterbrechung scheitert den Beat statt ihn wieder anzubieten'],
  [SZ, '  if (game.space.escorts) game.space.escorts = game.space.escorts.filter((q) => q.tag !== h.ally.tag);', '  if (false) game.space.escorts = game.space.escorts.filter((q) => q.tag !== h.ally.tag);', 'Verbündeter bleibt nach dem Gefecht im Raum'],
  [SZ, '  const p = npc ? Faden.chanceSpontanhilfe(npc) : 0;', '  const p = npc ? 0.5 : 0;', 'Chance der Spontanhilfe ignoriert die Haltung'],
  [SZ, '  if (!(wuerfel(game, h) < p)) return false;', '  if (!(game.rng.chance(p))) return false;', 'Wurf der Spontanhilfe zieht game.rng statt des eigenen Stroms'],
  [SZ, '  funk(game, fmt(T.vorwarnung[it.art], vars));', '  void vars;', 'Gefahr ohne Vorwarnung per Funk'],
  [SZ, '  const sek = Math.max(W.vorlauf_min_s, W.vorlauf_s);', '  const sek = 2;', 'Vorwarnung unter 8 s'],
  [SZ, "  const n = (it.art === 'raumschlacht' || it.art === 'befreiung') ? nachCrew(W[it.art].anzahl, crewN(game)) : 1;", "  const n = (it.art === 'raumschlacht' || it.art === 'befreiung') ? nachCrew(W[it.art].anzahl, 1) : 1;", 'Gegner nicht nach Crewgroesse skaliert'],
  [SZ, '  if (weg.length) sp.enemies = sp.enemies.filter((e) => !weg.includes(e));', '  if (false) sp.enemies = sp.enemies.filter((e) => !weg.includes(e));', 'Szenenwechsel räumt die Gegner der Szene nicht ab'],
  [SZ, '  andockenEnde(game);\n  Fracht.andocken(game);', '  Fracht.andocken(game);', 'Andocken beendet die laufende Szene nicht'],
  [FR, "  F().beatAusgang(game, f.id, 'gescheitert');   // der Ausgang entfernt die Ware", "  F().beatAusgang(game, f.id, 'gelungen');   // der Ausgang entfernt die Ware", 'verlorene Ware gilt als gelungen'],
  [FA, '  delete f.fracht;   // SUND-04a-2 P1: der Beat ist zu Ende', '  void 0;   // SUND-04a-2 P1: der Beat ist zu Ende', 'Ware bleibt nach dem Ende des Beats an Bord'],
  [FA, "  if (x.fracht !== undefined && x.fracht !== null && phase === 'laeuft' && D.BEATS[v.beats[f.beat].typ].baustein === 'fracht') {", '  if (false) {', 'Ware geht beim Speichern verloren (Leser)'],
  [FA, "  for (const f of F.liste) if (f.phase === 'laeuft' && D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene) {", "  for (const f of F.liste) if (false && f.phase === 'laeuft' && D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene) {", 'Szenen-Beat steht nach dem Laden nicht wieder aus'],
  // ---- Nacharbeit Welle 1 (L1 bis L6, K1, K2, K5, L13): Lebenszyklus, Persistenz ----
  [SZ, 'const aktiv = (game) => Faden.aktiv(game);', 'const aktiv = () => true;', 'Faden-Szenen starten auch ohne Schalter (Gate)'],
  [SZ, '!verfolgungLaeuft(game) && !Reise.gefahrLaeuft(game) && !game.ship.docked;', '!verfolgungLaeuft(game) && !game.ship.docked;', 'Faden-Szene startet bei laufender Reise-Gefahr'],
  [RE, 'if (game.simSzene || game.fadenSzene) L.ab = Math.max(L.ab, game.time + 1);', 'if (game.simSzene) L.ab = Math.max(L.ab, game.time + 1);', 'Reise-Gefahr trifft waehrend einer Faden-Szene ein'],
  [SZ, "(rg ? 'rg' + rg.nr : null));", 'null);', 'Kampf der Reise-Gefahr zaehlt nicht als Gefecht der Spontanhilfe'],
  [SZ, "  if (!aktiv(game)) { if (game.fadenSzene || game.fadenWarte || game.fadenHilfe || game.fadenHilfeWarte) zuruecksetzen(game); return; }", "  if (false) { zuruecksetzen(game); return; }", 'Takt ohne Schalter und Welt raeumt Reste nicht ab'],
  [SZ, '  game.fadenSzene = null; game.fadenWarte = null; game.fadenHilfe = null; game.fadenHilfeWarte = null; game.fadenSzeneN = 0;', '  void 0;', 'zuruecksetzen setzt nichts zurueck'],
  [GM, '    FadenSzene.zuruecksetzen(this);   // SUND-04a-2 Nacharbeit L3', '    void 0;   // SUND-04a-2 Nacharbeit L3', 'game.reset() setzt die Faden-Szenen nicht zurueck'],
  [SZ, "const salz = [W.spontanhilfe_salz, h.fadenId, h.nsc, h.beatId, F ? F.t : 0].join(':');", 'const salz = W.spontanhilfe_salz;', 'Wurf der Spontanhilfe: Salz ohne Faden, NSC, Beat und Zaehler'],
  [SZ, "const salz = [W.spontanhilfe_salz, h.fadenId, h.nsc, h.beatId, F ? F.t : 0].join(':');", "const salz = [W.spontanhilfe_salz, h.fadenId, h.nsc, h.beatId, 0].join(':');", 'Wurf der Spontanhilfe: ohne Taetigkeitszaehler'],
  [SZ, "const tag = 'nsc_' + h.nsc + '_' + (Fz ? Fz.t : 0);", "const tag = 'nsc_' + h.nsc;", 'Tag des Verbuendeten nicht je Hilfe eindeutig'],
  [SZ, 'hilfeWeg(game); game.fadenHilfe = null; hilfeNaechste(game); }\n  const h =', 'hilfeWeg(game); game.fadenHilfe = null; }\n  const h =', 'verwaiste Hilfe ersetzt: die neue ueberspringt die Warteschlange'],
  [SZ, 'if (laeuft(game, game.fadenSzene.fadenId, game.fadenSzene.beatId)) kampfBeginn(game, game.fadenSzene);', 'if (true) kampfBeginn(game, game.fadenSzene);', 'Kampf beginnt fuer einen Beat, der im Vorlauf endete'],
  [SZ, 'const C = W[fs.art]; const n = fs.n;', 'const C = W[fs.art]; const n = nachCrew(C.anzahl, crewN(game));', 'Gegnerzahl beim Spawn neu aus der Crew (nicht die angekuendigte)'],
  [SZ, "if (warte.length >= W.warteschlange_max) return { ok: false, grund: 'WARTESCHLANGE_VOLL' };", 'if (false) return { ok: false, grund: "WARTESCHLANGE_VOLL" };', 'Warteschlange der Szenen ohne Obergrenze'],
  [SZ, "if (warte.length >= W.warteschlange_max) return { ok: false, grund: 'HILFE_LAEUFT' };", 'if (false) return { ok: false, grund: "HILFE_LAEUFT" };', 'Warteschlange der Spontanhilfe ohne Obergrenze'],
  [SZ, '  h.ally = { tag, kampf: h.versucht };', '  h.ally = { tag, kampf: h.versucht }; game.space.enemies.push(es);', 'Verbuendeter steht unter den Gegnern (Crew-Geschosse treffen ihn)'],
  [GM, "this.markSaveDue('docked'); if (this.weltsim) { try { FadenSzene.andockenHook(this); } catch (e) { this.countError('faden-szene-andocken', e); } } this.lageGrenze('andocken'); }", "this.markSaveDue('docked'); this.lageGrenze('andocken'); if (this.weltsim) { try { FadenSzene.andockenHook(this); } catch (e) { this.countError('faden-szene-andocken', e); } } }", 'Andock-Hook der Faeden NACH dem Zaehlen der Taetigkeit (Frist vor Abliefern)'],
  [GM, "this.markSaveDue('docked'); if (this.weltsim) { try { FadenSzene.andockenHook(this); }", "this.markSaveDue('docked'); if (false) { try { FadenSzene.andockenHook(this); }", 'Andock-Hook der Faeden fehlt (Gate in game.js)'],
  [GM, "if (name === 'notsprung' && this.weltsim) { try { FadenFracht.notsprung(this); }", "if (false) { try { FadenFracht.notsprung(this); }", 'Notsprung-Hook der Ware fehlt (Ereignis in game.js)'],
  [GM, "if (this.fadenSzene || this.fadenHilfe || (this.fadenWarte && this.fadenWarte.length)) this.safe('fadenszene',", "if (false) this.safe('fadenszene',", 'Takt der Faden-Szenen fehlt (game.step)'],
  // ---- Nacharbeit L7: kaputte Fracht im Weltstand
  [FA, '    if (fr) f.fracht = fr;\n  }', '    if (!fr) return { fehler: `${x.id}: Fracht unbrauchbar` };\n    f.fracht = fr;\n  }', 'Leser: eine kaputte Fracht verwirft den ganzen Faden'],
  [FA, "x.fracht !== null && phase === 'laeuft' && D.BEATS", "x.fracht !== null && D.BEATS", 'Leser: Fracht ohne laufenden Beat bleibt im Faden'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
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

const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-faden-szene.js, test-faden-zustand.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
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
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
