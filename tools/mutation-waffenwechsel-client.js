'use strict';
// AUS-02 B: Mutationsprobe zu tools/test-waffenwechsel-client.js. Kopiert public/js, shared und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-waffenwechsel-client.js [begriff …] [--trocken]      (npm run test:waffenwechsel-client-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-wwclient-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
fs.mkdirSync(path.join(TMP, 'public'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(TMP, 'shared'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-waffenwechsel-client.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const TA = 'public/js/tasten.js', HU = 'public/js/hud.js', CL = 'public/js/client.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- die Pflicht-Mutationen
  [TA, "A('boden.slot1', 'boden', 'Waffenslot 1 nutzen (Boden)', NUM(1).reverse()),\n    A('boden.slot2', 'boden', 'Waffenslot 2 nutzen (Boden)', NUM(2).reverse()),", "A('boden.slot1', 'boden', 'Waffenslot 1 nutzen (Boden)', NUM(2).reverse()),\n    A('boden.slot2', 'boden', 'Waffenslot 2 nutzen (Boden)', NUM(1).reverse()),", 'Taste vertauscht (1 und 2)'],
  [HU, "return !s || i < Math.min(3, s.slotzahl | 0);", "return true;", 'Slotzahl-Prüfung weg (Taste 3 sendet bei 2 Slots)'],
  [CL, "case 'KeyQ':\n        if (m.zone === 'away') {\n          const w = Client.mouse.x >= 0 ? mouseWorld() : { x: Client.self.x, y: Client.self.y };\n          send({ t: P.C.MARK || 'mark',", "case 'KeyQ':\n        if (m.zone === 'away') {\n          const w = Client.mouse.x >= 0 ? mouseWorld() : { x: Client.self.x, y: Client.self.y };\n          send({ t: 'cmd', c: 'slot.nutzen', slot: 0, x: 0, y: 0,", 'Q-Handler geändert (Q wechselt statt zu markieren)'],
  [HU, "if (on && sp != null) { ctx.fillStyle = '#5A2A28';", "if (false) { ctx.fillStyle = '#5A2A28';", 'Sperr-Anzeige weg'],
  // ---- weitere Regeln
  [HU, "if (!w || !(t < w.bis)) return null;", "if (!w) return null;", 'Sperr-Anzeige endet nie'],
  [HU, "this.wechselSperre = d > 0 && isFinite(d) ? { bis: t + d, dauer: d } : null;", "this.wechselSperre = d > 0 && isFinite(d) ? { bis: t, dauer: d } : null;", 'Sperrende = Ereigniszeit (Sperre sofort vorbei)'],
  [CL, "H.wechselStart(Client.time, ev.sperre); }", "} H.wechselStart(Client.time, ev.sperre);", 'Sperre auch für fremde Spieler'],
  [CL, "if (m.zone === 'away' && !st.gp && !H.showCrew && window.Tasten) {", "if (!st.gp && !H.showCrew && window.Tasten) {", 'Waffentaste auch an Bord'],
  [CL, "if (m.zone === 'away' && !st.gp && !H.showCrew && window.Tasten) {", "if (m.zone === 'away' && !H.showCrew && window.Tasten) {", 'Waffentaste im Gespräch'],
  [CL, "if (m.zone === 'away' && !st.gp && !H.showCrew && window.Tasten) {", "if (m.zone === 'away' && !st.gp && window.Tasten) {", 'Waffentaste bei offenem Crew-Overlay'],
  [CL, "if (!m.downed && H.slotErlaubt(sl)) send(", "if (H.slotErlaubt(sl)) send(", 'Waffentaste sendet auch am Boden liegend'],
  [CL, "send({ t: 'cmd', c: P.CMD_SLOT_NUTZEN || 'slot.nutzen', slot: sl })", "send({ t: 'cmd', c: P.CMD_SLOT_NUTZEN || 'slot.nutzen', slot: 0 })", 'immer Slot 0 gesendet'],
  [CL, "    if (e.repeat) return;\n    // AUS-02 B:", "    // AUS-02 B:", 'Wiederholung (gehaltene Taste) wird gesendet'],
  [HU, "R.text(ctx, this.slotKappe(i), cx + 2, y,", "R.text(ctx, '', cx + 2, y,", 'Tastenziffer in der Zelle fehlt'],
  [HU, "if (belegt < 2) return 'Klick feuern · Q Mark. · C ducken';", "if (belegt < 0) return 'Klick feuern · Q Mark. · C ducken';", 'Wechselhinweis auch bei höchstens einer Waffe'],
  [HU, "const k = T && T.kappe ? T.kappe('boden.slot' + (i + 1)) : null;", "const k = null;", 'Tastenkappe ignoriert das Register (umbelegte Taste)'],
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
console.log(`Mutationsprobe test-waffenwechsel-client.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
