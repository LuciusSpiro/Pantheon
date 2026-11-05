'use strict';
// ITM-01 B: Mutationsprobe zu tools/test-medipack-client.js. Kopiert public/js, shared, server/sim/combat.js (nur gelesen) und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Regel und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-medipack-client.js [begriff …] [--trocken]      (npm run test:medipack-client-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-mpclient-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
fs.mkdirSync(path.join(TMP, 'public'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(TMP, 'shared'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'server', 'sim'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'server', 'sim', 'combat.js'), path.join(TMP, 'server', 'sim', 'combat.js'));
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-medipack-client.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const HU = 'public/js/hud.js', CO = 'public/js/consoles.js', CL = 'public/js/client.js', DM = 'public/js/dev-mock.js', TU = 'public/js/terminal-ui.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- HUD-Zelle
  [HU, "feld: n > 0 ? '#27394A' : '#1B252F'", "feld: '#27394A'", 'leeres Medipack sieht aus wie ein volles (gleiche Zellfarbe)'],
  [HU, "text: n > 0 ? PAL.star : '#5E6A78'", "text: PAL.star", 'leeres Medipack behält die helle Schrift'],
  [HU, "const n = Math.max(0, Math.floor(+me.medkit || 0));", "const n = me.medkit ? 1 : 0;", 'Zelle zeigt nur noch Flag statt Ladungszahl'],
  [HU, "namen: n > 0 ? ['Medipack ' + n, 'Medi ' + n, 'Med ' + n] : ['Medipack leer', 'Med 0'] };", "namen: n > 0 ? ['Medipack ' + n] : ['Medipack leer'] };", 'kein kurzer Name für die 3-Slot-Zelle (Name wird gekürzt, Ziffer fehlt)'],
  [HU, "const SLOT_ITEMS = ['scanner', 'medipack'];", "const SLOT_ITEMS = ['scanner'];", 'Medipack nicht als Slot-Item geführt'],
  [HU, "const iz = item ? itemZelle(id, view.me) : null;", "const iz = item ? itemZelle('scanner', view.me) : null;", 'jedes Item nimmt den Zellzustand des Scanners (Sonderfall statt allgemeiner Stelle)'],
  [HU, "medipack: 'Medipack: beschleunigt das Wiederbeleben und verarztet Verletzte, je Einsatz eine Ladung.", "medipack: 'Heilt 50 HP: beschleunigt das Wiederbeleben und verarztet Verletzte, je Einsatz eine Ladung.", 'Infotext nennt wieder „Heilt 50 HP“'],
  [HU, "medipack: 'Medipack: beschleunigt", "medipack: 'Medipack: 3 Ladungen, beschleunigt", 'Infotext mit fester Packgröße'],
  // ---- Station
  [CO, "if ((H.SLOT_ITEMS || []).includes(id)) this.itemSymbol(ctx, id, 43, y + 22);", "if ((H.SLOT_ITEMS || []).includes(id) && window.Scanner) window.Scanner.symbol(ctx, 43, y + 22, PAL.ice);", 'Station zeichnet für jedes Item das Scanner-Symbol (der alte Fehler)'],
  [CO, "      if (id === 'medipack') {\n        ctx.fillStyle = '#EDE6D6';", "      if (false) {\n        ctx.fillStyle = '#EDE6D6';", 'Medipack ohne eigenes Symbol'],
  [CO, "if (id === 'scanner') { if (window.Scanner) window.Scanner.symbol(ctx, x, y, PAL.ice); return; }", "if (id === 'scanner') { return; }", 'Scanner-Symbol fällt weg'],
  [CO, "1–8 direkt", "1–7 direkt", 'Hilfezeile nennt die achte Zeile nicht'],
  [CO, "medipack: 'Beschleunigt das Wiederbeleben, verarztet Verletzte (Nachschub fürs Außenteam).',", "medipack: 'Heilt 50 HP (Nachschub fürs Außenteam).',", 'Handelsliste (Station) sagt wieder „Heilt 50 HP“'],
  [TU, "medipack: 'Beschleunigt das Wiederbeleben, verarztet Verletzte (Nachschub fürs Außenteam).',", "medipack: 'Heilt 50 HP (Nachschub fürs Außenteam).',", 'Terminal sagt wieder „Heilt 50 HP“'],
  // ---- Revive-Beschriftung
  [CL, "const sec = m.medkit ? (W.medkitReviveTime || 1.5) : (W.reviveTime || 4);", "const sec = m.medkit === 1 ? (W.medkitReviveTime || 1.5) : (W.reviveTime || 4);", 'Revive-Zeit nur bei genau 1 Ladung kurz'],
  [CL, "(m.medkit ? ', Medipack' : '')", "(m.medkit === 1 ? ', Medipack' : '')", 'Beschriftung „Medipack“ nur bei genau 1 Ladung'],
  [CL, "carry === 'medipack' || m.medkit > 0", "carry === 'medipack'", 'NSC verarzten: Ladung zählt nicht'],
  // ---- dev-mock
  [DM, "if (kit) p.medkit -= 1;", "if (kit) p.medkit = 0;", 'Mock: Wiederbeleben leert das ganze Pack'],
  [DM, "q.medkit = PACK; q.dir = 'up'", "q.medkit = 1; q.dir = 'up'", 'Mock: Team startet mit Flag 1 statt Ladungen'],
  [DM, "const PACK = Math.max(1, Math.floor((CFG.medipack && CFG.medipack.ladungen) || 3));", "const PACK = 3;", 'Mock: feste Packgröße statt Konfiguration'],
  [DM, "const kit = act.kit && p.medkit > 0;", "const kit = p.medkit > 0;", 'Mock: Kit zählt nicht mehr vom Start der Aktion'],
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
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-medipack-client.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
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
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
