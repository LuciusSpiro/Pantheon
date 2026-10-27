'use strict';
// SUND-04a-3 Finale-UI: Mutationsprobe zu tools/test-finale-ui.js. Kopiert Server, Shared, Content, Client-Code und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je
// Lauf EINE Regel und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, SyntaxError, Zeitüberschreitung, keine Prüfzeile) zählt NICHT
// als erkannt. Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-finale-ui.js [begriff …] [--trocken]      (npm run test:finale-ui-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-finale-ui-'));
const kopiere = (rel) => { fs.mkdirSync(path.dirname(path.join(TMP, rel)), { recursive: true }); fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true }); };
['server', 'shared', 'content', 'public/js'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TESTS = [['tools/test-finale-ui.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const FI = 'public/js/finale.js', TUI = 'public/js/terminal-ui.js', TA = 'public/js/tasten.js', TK = 'public/js/pult-terminal-tokens.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- die fünf Pflicht-Mutationen
  [FI, "rest > 0 ? 'anfrage' : 'angebot';", "frist > 0 ? 'anfrage' : 'angebot';", 'Bestätigungsknopf ohne Frist (bleibt nach Ablauf stehen)'],
  [FI, "    store.finale = neu;\n  }", "    if (neu) store.finale = neu;\n  }", 'Löschsignal wird ignoriert'],
  [TUI, "warten(); cmd(view, 'finale.bestaetigen');", "warten(); cmd(view, 'finale.waehlen');", 'falscher Befehl beim Bestätigen'],
  [FI, "    if (!b || typeof b !== 'object') return null;\n    const phase", "    const phase", 'Müll im Block stürzt ab'],
  [TUI, "haupt: null, ablehnen: null });", "haupt: { text: 'x', disabled: false, onClick: () => finaleTaste(view) }, ablehnen: null });", 'Karte bei Phase läuft weiter klickbar'],
  // ---- weitere Regeln
  // (Die Prüfung rest <= 0 in finaleBestaetigen ist eine zweite Absicherung hinter zustand === 'anfrage' und gleichwertig: keine Mutation dafür.)
  [TUI, "|| now() - s.finaleT < FINALE_ENTPRELL_MS) return;", ") return;", 'kein Entprellen des Bestätigens'],
  [TUI, "warten(); cmd(view, 'finale.ablehnen');", "warten(); cmd(view, 'finale.waehlen');", 'Ablehnen sendet den falschen Befehl'],
  [TUI, "s.finaleT = now(); warten(); cmd(view, 'finale.waehlen');", "s.finaleT = now(); warten(); cmd(view, 'finale.bestaetigen');", 'Anfrage sendet den falschen Befehl'],
  [TUI, "const fi = finale(); if (s.zusehen || !fi || fi.zustand !== 'angebot' || wartetJetzt()) return;", "const fi = finale(); if (!fi || fi.zustand !== 'angebot' || wartetJetzt()) return;", 'Zuschauer dürfen anfragen'],
  [TUI, "if (s.zusehen || !fi || (fi.zustand !== 'angebot' && fi.zustand !== 'anfrage') || wartetJetzt()) return;", "if (!fi || wartetJetzt()) return;", 'Ablehnen für Zuschauer und im laufenden Finale'],
  [TUI, "else if (code === 'KeyN') finaleAblehnen(view);", "else if (code === 'KeyX') finaleAblehnen(view);", 'Ablehnen auf der Taste der Absichten (X)'],
  [TUI, "else if (code === 'KeyE') finaleTaste(view);", "else if (code === 'KeyE') { finaleTaste(view); annehmen(view, absicht(), (lageKarte(absicht(), a.lage) || {}).id); }", 'E nimmt zugleich eine Absicht an'],
  [TUI, "ev.ok ? FT('gewaehlt_' + (ev.op === 'bestaetigen' ? 'bestaetigen' : ev.op === 'ablehnen' ? 'ablehnen' : 'waehlen')) : (ev.text || FT('nicht_moeglich'))", "FT('gewaehlt_waehlen')", 'Antworttext: Absage des Servers wird verschluckt'],
  [TUI, "const fk = finaleKarte(view, bedienbar); if (fk) m.lage.finale = fk;", "", 'keine Karte im Bereich Kurs'],
  [FI, "if (msg.t === 'welcome') { store.finale = null; store.anfrageStart = null; return; }", "if (msg.t === 'welcome') { return; }", 'welcome leert nicht'],
  [FI, "if (msg.phase === 'lobby') { store.finale = null; store.anfrageStart = null; return; }", "", 'Lobby leert nicht'],
  [FI, "if (!hatAnfrage(store.finale) || store.anfrageStart == null) store.anfrageStart = uhr();", "store.anfrageStart = uhr();", 'jeder Block startet die Frist neu'],
  [FI, "rest = Math.max(0, Math.min(frist, Math.ceil((frist * 1000 - dt) / 1000)));", "rest = frist;", 'Frist zählt nicht mit'],
  [FI, "if (!name || (!phase && !(frei && angebot))) return null;", "if (!name) return null;", 'Karte auch ohne Angebot und ohne Finale'],
  [TK, "if (l.finale) { zeichneFinale(c, r, l.finale); r = fl(r); }", "if (l.finale) { zeichneFinale(c, r, l.finale); }", 'Absichten laufen unter die Karte'],
  [TK, "const farbe = anfrage ? 'warn' : phase ? 'modul' : 'preis';", "const farbe = anfrage ? 'waffe' : phase ? 'modul' : 'preis';", 'Anfrage in Rot'],
  [TK, "fn: anfrage ? 'warn' : 'nav'", "fn: anfrage ? 'weapon' : 'nav'", 'Bestätigen-Knopf in Rot'],
  [TK, "hotkey: kappe('terminal.finaleAblehnen', 'N')", "hotkey: kappe('terminal.finale', 'N')", 'Ablehnen trägt die Kappe des Bestätigens'],
  [TA, "['KeyN'], 'terminal.lage'", "['KeyX'], 'terminal.lage'", 'Tastenkollision N/X im Bereich Kurs'],
  [TA, "['KeyE'], 'terminal.lage'", "['Enter'], 'terminal.lage'", 'Tastenkollision E/Enter im Bereich Kurs'],
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
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz (Ausnahme, SyntaxError, Zeitüberschreitung, nur stderr) ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-finale-ui.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
