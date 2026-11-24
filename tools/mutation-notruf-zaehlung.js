'use strict';
// SPT-02 4: Mutationsprobe zu tools/test-notruf-zaehlung.js. Kopiert Server, Shared, Content, public/js und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-notruf-zaehlung.js [--trocken] [begriff …]
//   --trocken: prüft nur, ob jede Textstelle genau einmal gefunden wird (kein Testlauf)
// Bewusst nicht in der Liste (aequivalente Mutanten): (1) die Vorpruefung in annehmen (notruf_voll bei erreichter Grenze) und die Abbildung NOTRUF_VOLL -> notruf_voll nach abenteuerOeffnen sichern sich gegenseitig (einzeln entfernt meldet
// annehmen weiter notruf_voll); (2) notrufBrettFaden prueft zusaetzlich typeof f.notruf.marke === 'string', das leseFaden und abenteuerOeffnen ohnehin sicherstellen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-notruf-zaehlung-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-notruf-zaehlung.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'tools', 'faden-fixture.js'), path.join(TMP, 'tools', 'faden-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const PR = 'server/sim/faden-pruefer.js', BR = 'server/sim/abenteuer-brett.js', FA = 'server/sim/faden.js', RE = 'server/sim/reise-ereignis.js', CL = 'public/js/brett.js', NB = 'content/faeden/notruf-brett.json', BD = 'content/faeden/abenteuer-brett.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Zählung im Prüfer
  [PR, 'const aktiveRegulaer = (F) => aktive(F).filter((f) => !notrufBrettFaden(f));', 'const aktiveRegulaer = (F) => aktive(F);', 'a: Notruf-Faeden zaehlen in aktiv_max'],
  [PR, 'const abenteuerLaufend = (F) => aktiveRegulaer(F).filter((f) => f.plan).length;', 'const abenteuerLaufend = (F) => aktive(F).filter((f) => f.plan).length;', 'b: Notruf-Faeden zaehlen in laufend_max'],
  [PR, 'const notrufAktiv = (F) => aktive(F).filter(notrufBrettFaden);', 'const notrufAktiv = (F) => aktive(F).filter((f) => !!f.plan && f.beat === 0);', 'd: Notruf-Erkennung an der Form des Plans statt der Herkunft'],
  [PR, 'const notrufGrenzeErreicht = (F) => notrufAktiv(F).length >= NOTRUF_AKTIV_MAX;', 'const notrufGrenzeErreicht = (F) => notrufAktiv(F).length > NOTRUF_AKTIV_MAX;', 'e: Grenze erst bei mehr als notruf_aktiv_max'],
  [PR, 'const notrufGrenzeErreicht = (F) => notrufAktiv(F).length >= NOTRUF_AKTIV_MAX;', 'const notrufGrenzeErreicht = (F) => notrufAktiv(F).length >= 2;', 'f: Grenze schon bei zwei Notruf-Faeden (Zahl im Code statt aus den Daten)'],
  [PR, 'const notrufGrenzeErreicht = (F) => notrufAktiv(F).length >= NOTRUF_AKTIV_MAX;', 'const notrufGrenzeErreicht = (F) => false;', 'g: keine Grenze fuer Notruf-Faeden'],
  [PR, "if (a.notruf) { if (notrufGrenzeErreicht(F)) return fehl('NOTRUF_VOLL'", "if (false) { if (notrufGrenzeErreicht(F)) return fehl('NOTRUF_VOLL'", 'h: Pruefer: ein Notruf-Angebot geht durch die Pruefungen der regulaeren Abenteuer'],
  [PR, "if (a.notruf) { if (notrufGrenzeErreicht(F)) return fehl('NOTRUF_VOLL', `hoechstens ${NOTRUF_AKTIV_MAX} aktive Notrufe`); }", 'if (a.notruf) { }', 'i: Pruefer: ein Notruf-Angebot hat keine eigene Grenze'],
  [PR, "if (aktiveRegulaer(F).length + ctx.oeffnen >= W.aktiv_max) return fehl('OBERGRENZE', `höchstens", "if (aktive(F).length + ctx.oeffnen >= W.aktiv_max) return fehl('OBERGRENZE', `höchstens", 'j: faden_oeffnen des Spielleiters zaehlt Notruf-Faeden mit'],
  // ---- Brett: Annehmen, Anbieten, Snapshot
  [BR, "if (a.notruf) { if (P.notrufGrenzeErreicht(F)) return fehl('notruf_voll'); }   // SPT-02 4: ein Notruf-Angebot prueft NUR die eigene Grenze (notruf_aktiv_max), nie laeuft_schon oder kein_platz\n  else {", "if (false) { }\n  {", 'l: annehmen: ein Notruf-Angebot scheitert an laeuft_schon oder kein_platz'],
  [BR, "if (P.abenteuerGrenzeErreicht(F)) return fehl('laeuft_schon');\n    if (P.aktiveRegulaer(F).length >= W.aktiv_max) return fehl('kein_platz');", "if (P.abenteuerGrenzeErreicht(F)) return fehl('notruf_voll');\n    if (P.aktiveRegulaer(F).length >= W.aktiv_max) return fehl('kein_platz');", 'm: annehmen: ein regulaeres Angebot meldet notruf_voll statt laeuft_schon'],
  [BR, "if (P.aktiveRegulaer(F).length >= W.aktiv_max) return fehl('kein_platz');", "if (P.aktive(F).length >= W.aktiv_max) return fehl('kein_platz');", 'n: annehmen: kein_platz zaehlt Notruf-Faeden (bei drei Notrufen und einem Abenteuer)'],
  [BR, "  if (P.notrufGrenzeErreicht(F)) return null;   // SPT-02 4: bei notruf_aktiv_max", "  // (Grenze entfernt) bei notruf_aktiv_max", 'p: notrufAnbieten legt bei erreichter Grenze trotzdem ein Angebot an'],
  [BR, "function notrufGrenzeErreicht(game) { const F = game && game.weltsim && game.weltsim.faeden; return !!F && P.notrufGrenzeErreicht(F); }", 'function notrufGrenzeErreicht(game) { return false; }', 'q: Brett.notrufGrenzeErreicht (fuer taktNotruf) meldet nie'],
  [BR, "...(P.notrufBrettFaden(l) ? { notruf: 1 } : {}), ", '', 'r: Snapshot: laufend traegt kein notruf'],
  // ---- Takt-Notruf
  [RE, "try { if (require('./abenteuer-brett.js').notrufGrenzeErreicht(game)) return null; } catch (e) { /* ohne Brett keine Grenze */ }", '', 's: taktNotruf: bei drei Notruf-Faeden entsteht ein vierter Notruf'],
  // ---- Faden: Hook, Ausschnitt, Leser
  [FA, 'if (P.aktiveRegulaer(F).length >= W.aktiv_max) return null;   // SPT-02 4', 'if (P.aktive(F).length >= W.aktiv_max) return null;   // SPT-02 4', 't: ausgangMitPerson zaehlt Notruf-Faeden mit'],
  [FA, 'nn++ < P.NOTRUF_AKTIV_MAX : nr++ < W.aktiv_max', 'false : nr++ < W.aktiv_max', 'u: Ausschnitt: Notruf-Faeden fehlen (das Modell kann sie nicht weiterfuehren)'],
  [FA, 'nn++ < P.NOTRUF_AKTIV_MAX : nr++ < W.aktiv_max', 'nn++ < P.NOTRUF_AKTIV_MAX : nr++ < 1', 'v: Ausschnitt: regulaere Faeden nur bis 1'],
  [FA, 'platz: Math.max(0, W.aktiv_max - liste.filter((f) => !P.notrufBrettFaden(f)).length) };', 'platz: Math.max(0, W.aktiv_max - liste.length) };', 'w: Ausschnitt: platz zaehlt Notruf-Faeden mit'],
  [FA, "if (nf && r.faden.phase !== 'abgeschlossen' && P.notrufGrenzeErreicht(F)) {", "if (false) {", 'x: Leser: ein vierter Notruf-Faden wird nicht geklemmt'],
  [FA, "if (!nf && r.faden.phase !== 'abgeschlossen' && P.aktiveRegulaer(F).length >= W.aktiv_max) {", "if (r.faden.phase !== 'abgeschlossen' && P.aktive(F).length >= W.aktiv_max) {", 'y: Leser: Notruf-Faeden werden gegen aktiv_max geklemmt (und verworfen)'],
  [FA, "if (!nf && r.faden.plan && r.faden.phase !== 'abgeschlossen' && P.abenteuerLaufend(F)", "if (r.faden.plan && r.faden.phase !== 'abgeschlossen' && P.abenteuerLaufend(F)", 'z: Leser: Notruf-Faeden werden gegen laufend_max geklemmt (und verworfen)'],
  [FA, 'const nf = P.notrufBrettFaden(r.faden);', 'const nf = false;', 'za: Leser: Notruf-Faeden werden nicht erkannt'],
  // ---- Daten
  [NB, '"wert": 3,\n      "einheit": "Notruf-Fäden"', '"wert": 4,\n      "einheit": "Notruf-Fäden"', 'zb: Daten: notruf_aktiv_max 4'],
  [BD, '"notruf_voll": "Die Crew führt schon so viele Notrufe, wie sie bewältigen kann. Das Angebot bleibt."', '"notruf_voll": "Es laufen schon {n} Notrufe. Das Angebot bleibt."', 'zc: Daten: notruf_voll mit Platzhalter {n} (der Server setzt laufend_max ein)'],
  // ---- Client
  [CL, 'voll: laufend.filter((l) => !l.notruf).length >= laufendMax', 'voll: laufend.length >= laufendMax', 'zd: Client: Notruf-Faeden machen das Brett voll'],
  [CL, 'notruf: a.notruf === true || a.notruf === 1,', 'notruf: false,', 'ze: Client: das Notruf-Angebot traegt kein notruf'],
  [CL, 'notruf: l.notruf === true || l.notruf === 1,', 'notruf: false,', 'zf: Client: der laufende Notruf traegt kein notruf'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TROCKEN = process.argv.includes('--trocken');
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-notruf-zaehlung.js (${MUTATIONEN.length} Mutationen${TROCKEN ? ', trocken' : ''}, Kopie in ${TMP})`);
if (!TROCKEN) {
  const basis = lauf();
  console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  const stellen = text.split(alt).length - 1;
  if (stellen !== 1) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei}, ${stellen}x)`); ueberlebt++; continue; }
  if (TROCKEN) { console.log(`  ok   ${was}: Textstelle gefunden (${stellen}x)`); continue; }
  const neuText = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? neuText.replace(/\n/g, '\r\n') : neuText);
  const r = lauf();
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen ${TROCKEN ? 'gefunden (trocken)' : 'erkannt'}`);
process.exit(ueberlebt ? 1 : 0);
