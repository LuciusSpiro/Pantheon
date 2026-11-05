'use strict';
// ITM-01 A: Mutationsprobe zu tools/test-medipack.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-medipack.js [begriff …] [--trocken]      (npm run test:medipack-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-medipack-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-medipack.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const MP = 'server/sim/medipack.js', CB = 'server/sim/combat.js', IN = 'server/sim/interior.js', AW = 'server/sim/away.js', LO = 'server/sim/loadout.js', VO = 'server/sim/vorrat.js', G = 'server/game.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Pflicht: Ladung, Rückgabe, Träger, Standardloadout, volle Packs zuerst, Rest zuletzt
  [CB, "  if (kit) Medipack.verbrauchen(p);", "  if (kit) void 0;", 'Revive verbraucht keine Ladung'],
  [MP, "function verbrauchen(p) { if (p.medkit > 0) p.medkit -= 1; }", "function verbrauchen(p) { p.medkit = 0; }", 'Revive verbraucht alle Ladungen auf einmal'],
  [MP, "  if (packs > 0) Vorrat.einlagern(game, 'medipack', packs, 'medkit');\n", "", 'Rückgabe vergessen: voller Pack kommt nicht ins Lager zurück'],
  [MP, "  if (rest - packs * n > 0) Vorrat.einlagern(game, REST, rest - packs * n, 'medkit');\n", "", 'Rückgabe vergessen: Rest geht verloren'],
  [MP, "Vorrat.einlagern(game, 'medipack', packs, 'medkit');", "Vorrat.einlagern(game, 'medipack', packs * 2, 'medkit');", 'Rückgabe verdoppelt: zwei Packs zurück'],
  [MP, "  if (rest - packs * n > 0) Vorrat.einlagern(game, REST, rest - packs * n, 'medkit');", "  if (rest - packs * n > 0) Vorrat.einlagern(game, REST, rest, 'medkit');", 'Rückgabe verdoppelt: Rest in voller Höhe statt nur der Teilmenge'],
  [MP, "  const packs = Math.floor(rest / n);", "  const packs = Math.ceil(rest / n);", 'Teilmenge wird als ganzer Pack zurückgegeben (aufgerundet)'],
  [MP, "  if (!traegt(game, p)) return;\n  // Reihenfolge", "  // Reihenfolge", 'Nichtträger bekommt ein Kit'],
  [LO, "const standardLoadout = () => ['blaster', 'medipack', ...Array(SLOTS_MAX - 2).fill(null)];", "const standardLoadout = () => ['blaster', ...Array(SLOTS_MAX - 1).fill(null)];", 'Standardloadout ohne Medipack'],
  [MP, "  } else if (Vorrat.stand(game, REST) > 0) {", "  } else if (false) {", 'ITM-01 H: ohne volle Packs wird der Rest-Topf nicht genommen'],
  [MP, "  if ((game.inventory.medipack || 0) > 0) {\n    Vorrat.verbrauchen", "  if ((game.inventory.medipack || 0) > 0 && Vorrat.stand(game, REST) <= 0) {\n    Vorrat.verbrauchen", 'ITM-01 H: alte Reihenfolge, Rest-Topf vor den vollen Packs'],
  [MP, "  if ((game.inventory.medipack || 0) > 0) {\n    Vorrat.verbrauchen", "  if ((game.inventory.medipack || 0) > 0 && !(Vorrat.stand(game, REST) >= n)) {\n    Vorrat.verbrauchen", 'ITM-01 H: Rest-Topf ab einer Packgröße vor den vollen Packs'],
  // ---- weitere Regeln
  [MP, "    p.medkit = Math.min(n, rest);\n", "    p.medkit = rest;\n", 'Rest über N: mehr Ladungen als ein Pack fasst'],
  [MP, "    if (rest > n) Vorrat.einlagern(game, REST, rest - n, 'medkit');", "    void 0;", 'Rest über N: Überschuss geht verloren'],
  [MP, "  } else if (game.notice) game.notice(p, 'Kein Medipack im Lager.');", "  }", 'Lager leer: kein Hinweis an den Spieler'],
  [MP, "    p.medkit = n;\n  }", "    p.medkit = 1;\n  }", 'Pack aus dem Lager gibt nur eine Ladung'],
  [MP, "  p.medkit = 0;\n  if (!traegt", "  if (!traegt", 'ausgeben setzt den Zähler nicht zurück (Nichtträger behält Ladungen)'],
  [MP, "  if (!traegt(game, p)) return 'Kein Medipack-Slot.';\n", "", 'Aufheben: Nichtträger bekommt Ladungen'],
  [MP, "  if (p.medkit >= ladungen(game)) return 'Dein Medipack ist schon voll.';\n", "", 'Aufheben: voller Träger nimmt den Pack trotzdem'],
  [MP, "  p.medkit = n;\n  if (alt > 0) Vorrat.einlagern(game, REST, alt, 'medkit');\n  return null;", "  p.medkit += 1;\n  return null;", 'Aufheben füllt nur um eine Ladung auf'],
  [MP, "  if (alt > 0) Vorrat.einlagern(game, REST, alt, 'medkit');\n", "", 'G B1: Aufheben vernichtet die alten Restladungen'],
  [MP, "  if (alt > 0) Vorrat.einlagern(game, REST, alt, 'medkit');\n", "  if (alt > 0) Vorrat.einlagern(game, REST, alt + 1, 'medkit');\n", 'G B1: Aufheben erzeugt Ladungen aus dem Nichts'],
  [MP, "  p.medkit = n;\n  if (alt", "  p.medkit = n + alt;\n  if (alt", 'G B1: Aufheben verdoppelt den Rest (Träger behält ihn und Lager bekommt ihn)'],
  [AW, "(game.inventory.medipackCharges || 0) > 0 ? 'Kein voller Medipack mehr an Bord (nur '", "false ? 'Kein voller Medipack mehr an Bord (nur '", 'G H3: Nachschub-Hinweis ignoriert den Rest-Topf'],
  [G, "...(this.inventory.medipackCharges ? { medipackCharges: this.inventory.medipackCharges } : {}), ", "", 'G H3: Snapshot sendet den Rest-Topf nicht'],
  [CB, "      if (!(game.time < (p.medipackHinweisBis || 0))) { p.medipackHinweisBis = game.time + 3; game.notice(p, nein); }", "      game.notice(p, nein);", 'Darüberlaufen: Hinweis in jedem Tick (Spam)'],
  [CB, "    const nein = Medipack.aufheben(game, p);\n    if (nein) {   // kein Slot", "    const nein = null;\n    if (nein) {   // kein Slot", 'Darüberlaufen: Slot/Voll-Prüfung entfällt'],
  [CB, "  const nein = Medipack.aufheben(game, p);\n  if (nein) { game.notice(p, nein); return false; }", "  const nein = null;\n  if (nein) { game.notice(p, nein); return false; }", 'E am Bodenpack: Slot/Voll-Prüfung entfällt'],
  [AW, "  if (require('./combat.js').isV2(game) && !game.players.some(", "  if (false && !game.players.some(", 'Nachschub ohne Träger unten wird nicht abgelehnt'],
  [IN, "else if (p.medkit > 0) p.medkit -= 1;", "else if (p.medkit > 0) p.medkit = 0;", 'NSC-Heilen verbraucht alle Ladungen'],
  [IN, "else if (p.medkit > 0) p.medkit -= 1;", "else if (p.medkit > 0) p.medkit += 0;", 'NSC-Heilen verbraucht keine Ladung'],
  [CB, "    medkit: p.medkit > 0 ? p.medkit : 0,", "    medkit: p.medkit ? 1 : 0,", 'Snapshot: Ladungszahl wird nicht gesendet (nur 0/1)'],
  [MP, "Loadout.itemRegistrieren(ITEM_ID, nutzen);", "", 'Medipack nicht als Item angemeldet'],
  [CB, "  Medipack.ausgeben(game, p);\n", "", 'onArrive vergibt nichts'],
  [CB, "  Medipack.zurueckgeben(game, p);\n", "", 'onLeave gibt nichts zurück'],
  [MP, "  if (game.notice) game.notice(p, n > 0 ? 'Medipack: ' + n + (n === 1 ? ' Ladung' : ' Ladungen') : 'Medipack leer');", "  if (game.notice) game.notice(p, 'Medipack');", 'Taste im Slot zeigt den Rest nicht'],
  [MP, "  return null;\n}\n\n// Beim Laden", "  return 'Medipack: ' + n;\n}\n\n// Beim Laden", 'Handler gibt Text zurück statt null (Rückgabewert wird im Befehlsweg verworfen)'],
  [VO, "const SPAET = Object.freeze(['medipackCharges']);", "const SPAET = Object.freeze([]);", 'spätes Konto: erste Rest-Buchung mit Betrag NaN im Protokoll'],
  [MP, "const traegt = (game, p) => Loadout.wirksam(game, p).includes(ITEM_ID);", "const traegt = (game, p) => Loadout.loadoutFuer(game, p).includes(ITEM_ID);", 'Träger auch mit Medipack im nicht wirksamen Slot'],
  // ---- gleichwertig
  [G, "require('./sim/medipack.js');   // ITM-01 A", "void 0;   // ITM-01 A", 'game.js lädt medipack.js nicht selbst (combat.js lädt es ohnehin)', true],
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
console.log(`Mutationsprobe test-medipack.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
