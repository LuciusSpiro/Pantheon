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
  [TUI, "ev.ok ? (window.Finale && Finale.antwortText ? Finale.antwortText(ev.op) : '') : (ev.text || FT('nicht_moeglich'))", "FT('gewaehlt_waehlen')", 'Antworttext: Absage des Servers wird verschluckt'],
  [TUI, "const fk = finaleKarte(view, bedienbar); if (fk) m.lage.finale = fk;", "const fk = null;", 'keine Karte im Bereich Kurs'],
  [FI, "if (msg.t === 'welcome') { store.finale = null; store.anfrageStart = null; store.neuerAnlauf = false; store.pause = null; return; }", "if (msg.t === 'welcome') { return; }", 'welcome leert nicht'],
  [FI, "if (msg.phase === 'lobby') { store.finale = null; store.anfrageStart = null; store.neuerAnlauf = false; store.pause = null; return; }", "", 'Lobby leert nicht'],
  [FI, "if (!hatAnfrage(store.finale) || store.anfrageStart == null) store.anfrageStart = uhr();", "store.anfrageStart = uhr();", 'jeder Block startet die Frist neu'],
  [FI, "rest = Math.max(0, Math.min(frist, Math.ceil((frist * 1000 - dt) / 1000)));", "rest = frist;", 'Frist zählt nicht mit'],
  [FI, "if (!name || (!phase && !(frei && angebot))) return null;", "if (!name) return null;", 'Karte auch ohne Angebot und ohne Finale'],
  [TK, "if (l.finale) { zeichneFinale(c, r, l.finale); r = fl(r); }", "if (l.finale) { zeichneFinale(c, r, l.finale); }", 'Absichten laufen unter die Karte'],
  [TK, "const farbe = anfrage ? 'warn' : phase ? 'modul' : 'preis';", "const farbe = anfrage ? 'waffe' : phase ? 'modul' : 'preis';", 'Anfrage in Rot'],
  [TK, "fn: anfrage ? 'warn' : 'nav'", "fn: anfrage ? 'weapon' : 'nav'", 'Bestätigen-Knopf in Rot'],
  [TK, "hotkey: kappe('terminal.finaleAblehnen', 'N')", "hotkey: kappe('terminal.finale', 'N')", 'Ablehnen trägt die Kappe des Bestätigens'],
  [TA, "['KeyN'], 'terminal.lage'", "['KeyX'], 'terminal.lage'", 'Tastenkollision N/X im Bereich Kurs'],
  [TA, "['KeyE'], 'terminal.lage'", "['Enter'], 'terminal.lage'", 'Tastenkollision E/Enter im Bereich Kurs'],
  // ---- Welle 5 (S1 bis S5, K1, K3)
  [TUI, "if (fk && fk.haupt && bedienbar) m.lage.hilfe =", "if (false) m.lage.hilfe =", 'Tastenzeile ohne E und N (S1)'],
  [TUI, "hinweis: anfrage ? FT('frist') : fi.neuerAnlauf ? FT('neuer_anlauf') : FT('angebot_hinweis'),", "hinweis: anfrage ? FT('frist') : FT('angebot_hinweis'),", 'Neubeginn bleibt stumm (S4)'],
  [TUI, "if (s.finaleWechsel !== undefined && s.finaleWechsel !== fi.wechsel && s.antwort && s.antwort.finale) s.antwort = null;", "", 'Rückmeldung der Wahl bleibt nach dem Neubeginn stehen (S4)'],
  [FI, "else if (!neu || neu.phase || hatAnfrage(neu) || neu.angebot !== 1) store.neuerAnlauf = false;", "", '„Neuer Anlauf“ bleibt für immer (S4)'],
  [FI, "if (vorher && (vorher.phase === 'orbit' || vorher.phase === 'boden') && neu && !neu.phase && neu.angebot === 1) { store.neuerAnlauf = true; store.wechsel++; }", "", 'Neubeginn wird nicht erkannt (S4)'],
  [FI, "tag_angebot: 'FINALE · ANGEBOT'", "tag_angebot: 'ANGEBOT'", 'Tag ohne „FINALE ·“ (S3)'],
  [FI, "frist: 'Verstreicht die Frist, passiert nichts.'", "frist: 'Danach bleibt alles, wie es ist.'", 'Fristtext wie vorher (S2)'],
  [FI, "gewaehlt_ablehnen: 'Entscheidungsschlacht abgelehnt. Sie kommt in {n} Sprüngen wieder.'", "gewaehlt_ablehnen: 'Abgelehnt, ohne Folgen.'", 'Ablehnen-Rückmeldung ohne Pause (S1)'],
  [FI, "anfragen: 'Anfragen', bestaetigen: 'Bestätigen ({n} s)', ablehnen: 'Schlacht ablehnen'", "anfragen: 'Entscheidungsschlacht', bestaetigen: 'Bestätigen ({n} s)', ablehnen: 'Ablehnen'", 'Knopftexte wie vorher (S1)'],
  ['server/sim/finale.js', "pause: W.abstand_nach_ablehnen.wert", "pause: 99", 'Block trägt die falsche Pause (S1)'],
  ['content/welt/finale-werte.json', ' Fällt die Crew oder flieht sie, beginnt das Finale von vorn."', ' Fällt die Crew oder flieht sie, beginnt das Finale von vorn. Ablehnen kostet nichts."', 'Anzeigetext mit „Ablehnen kostet nichts.“ (S2)'],
  [TK, "else if (angebot) rand(c, k.x, k.y, k.w, k.h, farbe);", "", 'Angebot ohne Messingrahmen (S5)'],
  [TK, "else if (angebot) rand(c, k.x, k.y, k.w, k.h, farbe);", "else if (angebot) { rand(c, k.x, k.y, k.w, k.h, farbe); rand(c, k.x + 2, k.y + 2, k.w - 4, k.h - 4, farbe); }", 'Angebot mit doppeltem Rahmen (S5)'],
  [TK, "umbruchRolle(f.name || '', G.name.w, 2, 'titel').forEach((z, i) => txtRolle(c, z, G.name.x, G.name.y + i * SCHRIFT.zeileLuft, 'text', 'titel'))", "umbruch(f.name || '', G.name.w, 2).forEach((z, i) => txt(c, z, G.name.x, G.name.y + i * SCHRIFT.zeileLuft, 'text'))", 'Name nicht in der Rolle titel (S5)'],
  [TK, "const x0 = Math.floor(i * ges / n), sw = Math.max(2, Math.floor((i + 1) * ges / n) - x0 - 1)", "const x0 = i * 10, sw = 9", 'Segmentleiste endet vor dem Rand (S2)'],
  [TK, "by = G.hinweis.y - 5;", "by = G.hinweis.y - 2;", 'Segmentleiste auf hinweis.y − 2 (S2)'],
  [TK, "G.hinweis.y + 5 + i * SCHRIFT.zeileLuft, 'text'));", "G.hinweis.y + 3 + i * SCHRIFT.zeileLuft, 'text'));", 'Fristtext auf hinweis.y + 3 (S2)'],
  [TK, "ablehnen: { x: ix, y: k.y + k.h - 22, w: iw, h: 14 }", "ablehnen: { x: ix, y: k.y + k.h - 18, w: iw, h: 14 }", 'ablehnen.y wie vorher (S2)'],
  [TK, "fn: 'neutral', kontur: true,", "fn: 'neutral',", 'Ablehnen nicht als Kontur-Knopf (K3)'],
  [TK, "txt(c, q.fertig && q.fertigLabel ? q.fertigLabel : q.label, x + 5, y + 4, 'dim');", "txt(c, (q.fertig ? '+ ' : '') + q.label, x + 5, y + 4, 'modul');", 'Orbit erledigt als „+ Orbit“ in Mint (K1)'],
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
