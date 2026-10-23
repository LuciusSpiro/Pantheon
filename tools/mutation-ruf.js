'use strict';
// SUND-02b B: Mutationsprobe zu tools/test-ruf.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE
// Regel und verlangt, dass test-ruf.js rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-ruf.js          (npm run test:ruf-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mut-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-ruf.js'), path.join(TMP, 'tools', 'test-ruf.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  ['server/sim/ruf.js', 'if (wert >= RAENGE[k].ab) i = k;', 'if (wert > RAENGE[k].ab) i = k;', 'Rangschwelle: > statt >= (Grenzwert)'],
  ['server/sim/ruf.js', 'return rangIndexVon(ruf(game, \'rom\')) >= verlangt;', 'return rangIndexVon(ruf(game, \'rom\')) > verlangt;', 'rufErreicht: > statt >='],
  ['server/sim/ruf.js', 'if (!game.weltsim) return true;   // kein Ruf-System', 'if (!game.weltsim) return false;   // kein Ruf-System', 'rufErreicht ohne Modus: false statt true'],
  ['server/sim/ruf.js', 'Math.min(g.max, Math.max(g.min, v))', 'Math.max(g.min, v)', 'kein Höchstwert'],
  ['server/sim/ruf.js', 'Math.min(g.max, Math.max(g.min, v))', 'Math.min(g.max, v)', 'kein Mindestwert'],
  ['server/sim/ruf.js', 'if (Number.isFinite(b[f])) out[f] = klemmen(f, b[f]);', 'if (Number.isFinite(b[f])) out[f] = b[f];', 'Leser klemmt nicht'],
  ['server/sim/ruf.js', 'if (folge) for', 'if (false) for', 'Folge (Germanen sinken) entfällt'],
  ['server/sim/ruf.js', '|| !FRAKTIONEN.some((f) => ws.ruf[f])) return null;', '|| FRAKTIONEN.some((f) => ws.ruf[f])) return null;', 'toSave schreibt nur bei 0/0/0'],
  ['server/sim/ruf.js', "const szeneFlucht = (S) => quelle('fahrerflucht' + (S.ort ? '_ort_' : '_') + S.fraktion);", "const szeneFlucht = (S) => quelle('fahrerflucht_' + S.fraktion);", 'Fahrerflucht am Ort wie im Feld'],
  ['server/weltsim/wirkungen.js', 'if (!istZahl(wk.delta) || wk.delta === 0)', 'if (!istZahl(wk.delta))', 'Prüfer: delta 0 erlaubt'],
  ['server/weltsim/wirkungen.js', 'if (Math.abs(wk.delta) > W.delta_max.wert)', 'if (Math.abs(wk.delta) > W.delta_max.wert + 1)', 'Prüfer: delta-Grenze um 1 zu weit'],
  ['server/weltsim/wirkungen.js', "if (W.quellen.wert[wk.grund].fraktion !== wk.fraktion)", "if (false)", 'Prüfer: Grund passt nicht zur Fraktion'],
  ['server/weltsim/wirkungen.js', "|| !has(W.quellen.wert, wk.grund)) return 'unbekannter Grund (grund)';", "|| false) return 'unbekannter Grund (grund)';", 'Prüfer: unbekannter Grund (auch die Folgeprüfung des Grundes entfällt)', ['if (W.quellen.wert[wk.grund].fraktion !== wk.fraktion)', 'if ((W.quellen.wert[wk.grund] || { fraktion: wk.fraktion }).fraktion !== wk.fraktion)']],
  ['server/sim/kriegslage.js', '    ws.ruf = rufSicher;\n', '', 'kein Rollback des Rufs'],
  ['server/sim/kriegslage.js', '    rang = Ruf.anwenden(game, gueltig);', '    rang = null;', 'Wirkung wird nie angewandt'],
  ['server/sim/kriegslage.js', "  game.weltsim.ruf = Ruf.lesen(b.ruf);", "  game.weltsim.ruf = Ruf.neu();", 'Laden vergisst den Ruf'],
  ['server/sim/kriegslage.js', 'const rb = Ruf.toSave(ws); if (rb) b.ruf = rb;', '', 'Speichern vergisst den Ruf'],
  ['server/sim/kriegslage-szene.js', '.concat(Ruf.szeneFlucht(S))', '', 'Fahrerflucht kostet nichts'],
  ['server/sim/kriegslage-szene.js', 'w.push(...Ruf.szeneSieg(S, w.some(', 'w.push(...Ruf.szeneSieg(S, false && w.some(', 'Verteidigung zählt wie Feldsieg'],
  ['server/sim/kriegslage-szene.js', 'w.push(...Ruf.szeneSieg(', '[].push(...Ruf.szeneSieg(', 'Sieg gibt keinen Ruf'],
  ['server/game.js', "rk !== this.sentRufKey && ", "", 'world.ruf wird bei jedem Snapshot gesendet'],
  ['server/game.js', "world.ruf = Ruf.snapshot(this); this.sentRufKey = rk;", "world.ruf = Ruf.snapshot(this);", 'sentRufKey wird nie gesetzt'],
  ['content/welt/ruf-werte.json', '"fahrerflucht_ger":       {"fraktion": "rom", "delta": -3,', '"fahrerflucht_pirat": {"fraktion": "rom", "delta": -3}, "fahrerflucht_ger":       {"fraktion": "rom", "delta": -3,', 'Daten: Flucht vor Piraten kostet Ruf'],
  ['content/welt/ruf-werte.json', '"rom": {"min": 0, "max": 220}', '"rom": {"min": -20, "max": 220}', 'Daten: Rom darf unter 0'],
  ['content/welt/ruf-werte.json', '{"id": "centurio", "name": "Centurio", "ab": 30}', '{"id": "centurio", "name": "Centurio", "ab": 5}', 'Daten: Schwelle nicht aufsteigend'],
  ['content/welt/ruf-werte.json', '"sieg_feld_ger":          {"fraktion": "rom", "delta": 3,', '"sieg_feld_ger":          {"fraktion": "rom", "delta": 0,', 'Daten: Quelle mit delta 0'],
];

let ueberlebt = 0;
console.log(`Mutationsprobe test-ruf.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = spawnSync(process.execPath, ['tools/test-ruf.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
console.log(`  Ausgangslage (unverändert): ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
for (const [datei, alt, neu, was, zusatz] of MUTATIONEN) {
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  const mut = text.replace(alt, () => neu);
  const mut2 = zusatz ? mut.replace(zusatz[0], () => zusatz[1]) : mut;
  fs.writeFileSync(f, nl ? mut2.replace(/\n/g, '\r\n') : mut2);
  const r = spawnSync(process.execPath, ['tools/test-ruf.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen erkannt');
process.exit(ueberlebt ? 1 : 0);
