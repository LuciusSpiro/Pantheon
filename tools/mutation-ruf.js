'use strict';
// SUND-02b B: Mutationsprobe zu tools/test-ruf.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE
// Regel und verlangt, dass test-ruf.js rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-ruf.js [--trocken]          (npm run test:ruf-mutation)
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
  ['server/sim/ruf.js', "const szeneFlucht = (S, ortBelagert) => quelle('fahrerflucht' + (ortBelagert ? '_ort_' : '_') + S.fraktion);", "const szeneFlucht = (S, ortBelagert) => quelle('fahrerflucht_' + S.fraktion);", 'Fahrerflucht am Ort wie im Feld'],
  ['server/sim/kriegslage-szene.js', "const imKampf = S.phase === 'kampf';", "const imKampf = true;", 'B-Fix 1: Sprung in der Vorwarnung kostet Ruf'],
  ['server/sim/kriegslage-szene.js', "S.ort && Kern.pruefeWirkung(game.weltsim.zustand, { typ: 'ort_gehalten', ort: S.hex }).ok) : [];", "!!S.ort) : [];", 'B-Fix 2: Flucht am Ort ohne laufende Belagerung zieht den Ortssatz ab'],
  ['server/sim/kriegslage-szene.js', "w.push(...Ruf.szeneSieg(S, w.some((x) => x.typ === 'ort_gehalten' && Kern.pruefeWirkung(z, x).ok)));", "w.push(...Ruf.szeneSieg(S, !!S.ort));", 'B-Fix 2: Sieg zaehlt den Ort ohne Belagerung'],
  ['server/weltsim/wirkungen.js', "'unbekannte Fraktion (fraktion)';\n      if (!istZahl(wk.delta) || wk.delta === 0)", "'unbekannte Fraktion (fraktion)';\n      if (!istZahl(wk.delta))", 'Prüfer: delta 0 erlaubt'],
  ['server/weltsim/wirkungen.js', "return 'unbekannte Fraktion (fraktion)';\n      if (!istZahl(wk.delta) || wk.delta === 0) return 'delta muss eine Zahl ungleich 0 sein';\n      if (Math.abs(wk.delta) > W.delta_max.wert)", "return 'unbekannte Fraktion (fraktion)';\n      if (!istZahl(wk.delta) || wk.delta === 0) return 'delta muss eine Zahl ungleich 0 sein';\n      if (Math.abs(wk.delta) > W.delta_max.wert + 1)", 'Prüfer: delta-Grenze um 1 zu weit'],
  ['server/weltsim/wirkungen.js', "if (W.quellen.wert[wk.grund].fraktion !== wk.fraktion)", "if (false)", 'Prüfer: Grund passt nicht zur Fraktion'],
  ['server/weltsim/wirkungen.js', "|| !has(W.quellen.wert, wk.grund)) return 'unbekannter Grund (grund)';\n      if (W.quellen.wert[wk.grund].fraktion !== wk.fraktion)", "|| false) return 'unbekannter Grund (grund)';\n      if ((W.quellen.wert[wk.grund] || { fraktion: wk.fraktion }).fraktion !== wk.fraktion)", 'Prüfer: unbekannter Grund (auch die Folgeprüfung des Grundes entfällt)'],
  ['server/sim/kriegslage.js', '    ws.ruf = rufSicher;\n', '', 'kein Rollback des Rufs'],
  ['server/sim/kriegslage.js', '    rang = Ruf.anwenden(game, gueltig.concat(po.wirkungen));', '    rang = null;', 'Wirkung wird nie angewandt'],
  ['server/sim/kriegslage.js', "  game.weltsim.ruf = Ruf.lesen(b.ruf);", "  game.weltsim.ruf = Ruf.neu();", 'Laden vergisst den Ruf'],
  ['server/sim/kriegslage.js', 'const rb = Ruf.toSave(ws); if (rb) b.ruf = rb;', '', 'Speichern vergisst den Ruf'],
  ['server/sim/kriegslage-szene.js', '.concat(ruf)', '', 'Fahrerflucht kostet nichts'],
  ['server/sim/kriegslage-szene.js', 'w.push(...Ruf.szeneSieg(S, w.some(', 'w.push(...Ruf.szeneSieg(S, false && w.some(', 'Verteidigung zählt wie Feldsieg'],
  ['server/sim/kriegslage-szene.js', 'w.push(...Ruf.szeneSieg(', '[].push(...Ruf.szeneSieg(', 'Sieg gibt keinen Ruf'],
  ['server/game.js', "rk !== this.sentRufKey && ", "", 'world.ruf wird bei jedem Snapshot gesendet'],
  ['server/game.js', "world.ruf = Ruf.snapshot(this); this.sentRufKey = rk;", "world.ruf = Ruf.snapshot(this);", 'sentRufKey wird nie gesetzt'],
  ['server/sim/ruf.js', "FRAKTIONEN.map((f) => ruf(game, f)).join(':')", "ruf(game, 'rom')", 'B-Fix 3 (B): Snapshot-Schlüssel nur aus rom'],
  ['server/game.js', "!includeAsteroids && !includeWorld && !includeLog && !includeBook) { world.ruf = Ruf.snapshot(this);", "true) { world.ruf = Ruf.snapshot(this);", 'B-Fix 3 (E): world.ruf auch in den großen Snapshots'],
  ['server/game.js', "this.sentLageKey = null; this.sentRufKey = null; this.sentAbsichtKey = null; this.sentFunkKey = null; this.sentBittenKey = null; this.sentInfoKey = null;\n    this.log(`Spieler ${p.name} (${p.id}) beigetreten.`);", "this.sentLageKey = null; this.sentAbsichtKey = null; this.sentFunkKey = null; this.sentBittenKey = null; this.sentInfoKey = null;\n    this.log(`Spieler ${p.name} (${p.id}) beigetreten.`);", 'B-Fix 3 (C): Beitritt setzt sentRufKey nicht zurück'],
  ['server/game.js', "this.sentRufKey = null; this.sentAbsichtKey = null; this.sentFunkKey = null; this.sentBittenKey = null; this.sentInfoKey = null;\n    this.runId = null;", "this.sentAbsichtKey = null; this.sentFunkKey = null; this.sentBittenKey = null; this.sentInfoKey = null;\n    this.runId = null;", 'B-Fix 3 (D): reset() setzt sentRufKey nicht zurück'],
  ['server/game.js', "else if (!rk && this.sentRufKey) { world.ruf = null; this.sentRufKey = null; }", "", 'B-Fix 3: kein Löschsignal'],
  ['server/sim/ruf.js', "ws.ruf[a[0]] = klemmen(a[0], v);", "ws.ruf[a[0]] = v;", 'B-Fix 4: Debug klemmt nicht'],
  ['content/welt/ruf-werte.json', '"fahrerflucht_ger":       {"fraktion": "rom", "delta": -3,', '"fahrerflucht_pirat": {"fraktion": "rom", "delta": -3}, "fahrerflucht_ger":       {"fraktion": "rom", "delta": -3,', 'Daten: Flucht vor Piraten kostet Ruf'],
  ['content/welt/ruf-werte.json', '"rom": {"min": 0, "max": 220}', '"rom": {"min": -20, "max": 220}', 'Daten: Rom darf unter 0'],
  ['content/welt/ruf-werte.json', '{"id": "centurio", "name": "Centurio", "ab": 30}', '{"id": "centurio", "name": "Centurio", "ab": 5}', 'Daten: Schwelle nicht aufsteigend'],
  ['content/welt/ruf-werte.json', '"sieg_feld_ger":          {"fraktion": "rom", "delta": 3,', '"sieg_feld_ger":          {"fraktion": "rom", "delta": 0,', 'Daten: Quelle mit delta 0'],
];

// --trocken: nur der Anker-Check (jeder Anker genau einmal im Quelltext der Kopie, sonst Exit 2); die Tests laufen nicht
if (process.argv.includes('--trocken')) {
  const schlecht = [];
  for (const [datei, alt, neu, was, zusatz] of MUTATIONEN) {
    let text;
    try { text = fs.readFileSync(path.join(TMP, datei), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { schlecht.push(was + ': Datei fehlt (' + datei + ')'); continue; }
    const n = text.split(alt).length - 1;
    if (n !== 1) { schlecht.push(was + (n === 0 ? ': Anker nicht gefunden' : ': Anker ' + n + 'x gefunden') + ' (' + datei + ')'); continue; }
    if (Array.isArray(zusatz) && !text.replace(alt, () => neu).includes(zusatz[0])) schlecht.push(was + ': zweiter Anker nicht gefunden (' + datei + ')');
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  process.exit(0);
}

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
