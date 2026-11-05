'use strict';
// SCA-01 P1: Mutationsprobe zu tools/test-scanner.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-scanner.js [begriff …] [--trocken]      (npm run test:scanner-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-scanner-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-scanner.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const SCN = 'server/sim/scanner.js', AB = 'server/sim/abstimmung.js', CB = 'server/sim/combat.js', IN = 'server/sim/interior.js', G = 'server/game.js', LO = 'server/sim/loadout.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- die vier Pflicht-Mutationen
  [CB, "function ankerTreffer(game, p) {\n  scannerTreffer(game, p);\n", "function ankerTreffer(game, p) {\n", 'Treffer-Hook entfernt (Treffer bricht den Scan nicht ab)'],
  [SCN, "  scanUnterbrochen(game, p);\n  if (game.notice) game.notice(p, 'Getroffen", "  if (game.notice) game.notice(p, 'Getroffen", 'Treffer: Zustand und Hold nicht aufgeräumt (Fortschritt bleibt)'],
  [SCN, "function scanUnterbrochen(game, p) {\n  if (!p) return;\n", "function scanUnterbrochen(game, p) {\n  if (!p) return;\n  if (p.scan && p.scan.halt > 0.5) { const C = cfg(game); const st = Abst.abbruchQualitaet(p.scan, C); for (const fn of handler.slice()) fn(game, p, st, { x: p.x, y: p.y }); }\n", 'Abbruch vergibt Qualität (Ergebnis trotz Abbruch)'],
  [LO, "  if (!Number.isInteger(slot) || slot < 0 || slot >= slotzahl(game)) return 'Diesen Slot gibt es nicht.';\n  const id = wirksam(game, p)[slot];\n", "  const id = loadoutFuer(game, p)[slot];\n", 'Slot-Prüfung entfernt: Scanner im nicht wirksamen Slot startet'],
  [SCN, "  if (p.zone !== 'away') return 'Nur am Boden.';\n", "", 'Scanner startet auch am Schiff (zone nicht geprüft)', true],   // gleichwertig: slotNutzen lehnt das schon vor dem Handler ab
  // ---- weitere Regeln
  [LO, "  return istWaffe(id) ? Waffen.waffeWechseln(game, p, id) : itemNutzen(game, p, id);", "  return Waffen.waffeWechseln(game, p, id);", 'Items werden nicht an die Registry gegeben (Scanner startet nie)'],
  [SCN, "Loadout.itemRegistrieren(ITEM_ID, scanStarten);", "", 'Scanner nicht als Item angemeldet'],
  [SCN, "  if (laeuft(p)) { scanUnterbrochen(game, p); if (game.notice) game.notice(p, 'Scan abgebrochen.'); return null; }\n", "", 'zweite Betätigung der Slot-Taste bricht nicht ab'],
  [SCN, "  if (rest > 0) return", "  if (false) return", 'keine Abklingzeit nach Erfolg'],
  [SCN, "  p.scanBis = game.time + C.abklingzeit;\n", "", 'Erfolg setzt keine Abklingzeit'],
  [SCN, "  if (laeuft(p)) { scanUnterbrochen(game, p); if (game.notice) game.notice(p, 'Scan abgebrochen.'); return null; }\n  if (p.zone", "  if (laeuft(p)) { scanUnterbrochen(game, p); p.scanBis = game.time + cfg(game).abklingzeit; return null; }\n  if (p.zone", 'Abbruch löst Abklingzeit aus (gilt nur nach Erfolg)'],
  [SCN, "  const stufe = Abst.qualitaetAus(C, C.dauer / p.scan.t);", "  const stufe = 3;", 'Qualität immer 3 (Verlauf ignoriert)'],
  [SCN, "  const stufe = Abst.qualitaetAus(C, C.dauer / p.scan.t);", "  const stufe = Abst.qualitaetAus(C, p.scan.halt);", 'Qualität aus Fortschritt statt aus dem Anteil sauberer Zeit'],
  [SCN, "    if (p.scan.halt >= 1) vollendet(game, p);", "    if (p.scan.halt >= 0.5) vollendet(game, p);", 'Scan endet vor Vollfortschritt'],
  [SCN, "  p.scan.dir = Number(dir) > 0 ? 1 : Number(dir) < 0 ? -1 : 0;", "  p.scan.dir = 1;", 'scan.stimme ignoriert die Richtung'],
  [SCN, "!p.hold || p.hold.scan !== p.scan || p.zone !== 'away' || !p.connected || p.downed) { scanUnterbrochen(game, p); continue; }", "false) { scanUnterbrochen(game, p); continue; }", 'update räumt hängenden Zustand nicht auf (Hold weg, Kartenwechsel, Trennung)'],
  [IN, "    if (p.moving || p.console || p.downed || p.zone !== 'away') p.hold = null;\n    return;", "    return;", 'Bewegung/Konsole/Niederstrecken brechen den Scan-Hold nicht ab'],
  [IN, "  if (p.hold && (p.hold.kind === 'minigame' || p.hold.kind === 'scan')) return;", "  if (p.hold && p.hold.kind === 'minigame') return;", 'verirrtes E-Loslassen bricht den Scan ab'],
  [G, "    if (c === Protocol.CMD_SCAN_ABBRUCH) { try { Scanner.scanAbbrechen(this, p); }", "    if (c === Protocol.CMD_SCAN_ABBRUCH) { try { void 0; }", 'Befehl scan.abbruch ohne Wirkung'],
  [G, "Scanner.scanStimme(this, p, Number(msg.dir));", "void msg.dir;", 'Befehl scan.stimme ohne Wirkung'],
  [G, "    if (h.kind === 'scan') return { kind: 'scan', progress: r2(Math.min(1, h.scan.halt)) };", "    if (h.kind === 'scan') return { kind: 'scan', progress: 0 };", 'Snapshot action: Fortschritt fehlt'],
  [G, "        ...((sc) => (sc ? { sc } : {}))(Scanner.snapshotFuer(this, p)),", "        sc: Scanner.snapshotFuer(this, p),", 'Snapshot sc auch ohne Scan (null-Feld)'],
  [SCN, "  return { f: r2(s.f), s: r2(s.s), h: r2(s.halt), q: Abst.schaetzung(s, cfg(game)) };", "  return { f: r2(s.f), s: r2(s.s), h: r2(s.halt), q: Abst.schaetzung(s, cfg(game)), t: s.t, z: s.ziel };", 'Snapshot sc verrät das Zielband'],
  [SCN, "  if (!game.players.some(laeuft)) return;   // früher Rücksprung: niemand scannt\n", "", 'update ohne frühen Rücksprung', true],   // gleichwertig im Verhalten (Schleife tut nichts); nur Kosten
  // ---- geteilte Rechnung (Ops-Pfad)
  [AB, "  e.ziel += e.zv * fak * dt;", "  e.ziel += e.zv * dt;", 'Ops: Drift ohne Verstärkung im Nebel'],
  [AB, "  e.zt -= dt;\n  if (e.zt <= 0) { e.zt = 2 + rng() * 2; e.zv = (rng() * 2 - 1) * C.driftV; }", "  e.zt -= dt;\n  if (e.zt <= 0) { e.zv = (rng() * 2 - 1) * C.driftV; e.zt = 2 + rng() * 2; }", 'Ops: Reihenfolge der rng-Aufrufe vertauscht'],
  [AB, "  e.halt = Math.min(1, e.halt + (dt / C.dauer) * e.s);", "  e.halt = Math.min(1, e.halt + (dt / C.dauer) * e.s * 1.01);", 'Ops: Fortschritt leicht verändert'],
  [AB, "  e.ziel = C.zielMin + rng() * (C.zielMax - C.zielMin);", "  e.ziel = C.zielMin + rng() * (C.zielMax - C.zielMin); rng();", 'Ops: zusätzlicher rng-Aufruf beim Anlauf'],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 120000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-scanner.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (keine Beobachtung möglich): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
