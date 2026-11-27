'use strict';
// TRA-01 Nacharbeit Runde 2: Mutationsprobe zu tools/test-training-nacharbeit2.js (P1 bis P4, S4, K3 bis K6): je Lauf wird EINE Regel in einer Kopie des Repos (Temp-Verzeichnis, nie im Repo)
// entfernt und der Test muss rot werden (Exit 1 MIT FEHLER-Zeile). Abstürze (Exit != 0 ohne FEHLER-Zeile) zählen NICHT als erkannt. Vorab: jeder Anker steht genau einmal (Exit 2, wenn nicht).
// Die Mutationen der Trainingsliste (S2, S3, S5 bis S8) stehen in tools/test-training-hud.js (Abschnitt „Mutationen“), die Sprechspalte in tools/test-bot-sprache.js.
//   node tools/mutation-training-nacharbeit2.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-training-nacharbeit2-'));
for (const rel of ['server', 'shared', 'content', 'public']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['test-training-nacharbeit2.js', 'sim-training-captain.js', 'sim-training.js', 'gen-tra-captain.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
const aufraeumen = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } };

const ER = 'server/sim/training-erkennung.js', GEN = 'tools/gen-tra-captain.js', ME = 'public/js/menue.js', UI = 'public/js/menue-ui.js', BS = 'public/js/bot-sprache-start.js', PT = 'public/js/pult-befehl-tokens.js';
const TEST = 'tools/test-training-nacharbeit2.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [ER, "if (!T.kursFahrt || dist(game.ship.x", "if (dist(game.ship.x", 'P1a: die Marke zählt auch ohne Fahrt nach dem Kursbefehl'],
  [ER, "  if (!erreicht(game, 'marke_erreicht')) vergessen(game, 'bot_befehl:nav.stopp');\n", '', 'P1b: ein Stopp unterwegs zählt für das Ziel stopp'],
  [GEN, "    enter: vergessen('bot_befehl:nav.kurs', 'bot_befehl:nav.stopp', 'marke_erreicht', 'bot_name'),", '', 'P1c: Schritt kurs vergisst die Befehle von vorher nicht'],
  [GEN, ".concat(vergessen('bot_befehl:tech.reparieren', 'repariert', 'bot_befehl:bot.status', 'bot_befehl:bot.automatik')),", ',', 'P1d: Schritt reparatur vergisst die Befehle von vorher nicht'],
  [GEN, "    enter: vergessen('bot_befehl:nav.sprung', 'sprung', 'schnellsprung'),\n", '', 'P1e: Schritt sprung vergisst die Sprünge von vorher nicht'],
  [GEN, "'ziel.abstand': DAS('Livia: Abstand zum Ziel befehlen (für den Schussbogen)')", "'ziel.abstand': DAS('Livia: Abstand zum Ziel halten (Schussbogen)')", 'P4a: abstand verspricht wieder den Schussbogen'],
  [GEN, "'ziel.scan': DAS('Cassius: Scan befehlen (das Ziel muss in Reichweite sein)')", "'ziel.scan': DAS('Cassius: das Ziel scannen (in Reichweite)')", 'P4b: scan verspricht wieder die Reichweite'],
  [ME, "      if (k.sprachwahl && store.trainingSprache) botSpracheEinschalten();\n", '', 'P2a: Start der Sprachvariante schaltet die Bot-Sprache nicht ein'],
  [ME, "if (S && typeof S.an === 'function' && typeof S.setze === 'function' && !S.an())", "if (S && typeof S.an === 'function' && typeof S.setze === 'function')", 'P2b: schaltet auch ein, wenn sie schon an ist'],
  [BS, "      if (wunsch || e.repeat) return;\n", "      if (e.repeat) return;\n", 'P2c: Meldung auch bei eingeschalteter Sprache'],
  [BS, "if (!(st && TH && TH.istTraining(st.mission)) || !window.Hud) return;", "if (!window.Hud) return;", 'P2d: Meldung auch außerhalb des Trainings'],
  [UI, "e.fortsetzen ? (crewListe || T.detail.spieler) : e.solo ? T.detail.einSpieler + ' · ' + T.detail.keinWeltstand : voll ?", "e.fortsetzen ? (crewListe || T.detail.spieler) : voll ?", 'P3a: Hauptmenü zeigt beim Training wieder „1–4 Spieler“'],
  [UI, "txt(c, T.detail.einSpieler + ' · ' + T.detail.keinWeltstand, TD.x + 10, TD.y + 70, MF.text);", "txt(c, T.detail.spieler + ' · ' + T.detail.keinWeltstand, TD.x + 10, TD.y + 70, MF.text);", 'P3b: Unterseite zeigt wieder „1–4 Spieler“'],
  [UI, "if (ich && !training) botHinzufuegenKnoepfe(c, x, y, CR.w, CR.h, view);", "if (ich) botHinzufuegenKnoepfe(c, x, y, CR.w, CR.h, view);", 'P3c: Trainings-Lobby zeigt Bot-Plätze'],
  [UI, "if (training) { txt(c, T.training.allein[0]", "if (false) { txt(c, T.training.allein[0]", 'P3d: Trainings-Lobby zeigt den Raumcode'],
  [UI, ".concat(training ? [] : [[MX.status.raum, code() || '–', MF.gold]])", ".concat([[MX.status.raum, code() || '–', MF.gold]])", 'P3e: Statuszeile der Trainings-Lobby zeigt den Raumcode'],
  [UI, "].filter((h) => !training || (h[2] !== 'link' && h[2] !== 'bot')), rx);", "], rx);", 'P3f: Trainings-Lobby bietet Link und Bot als Hinweis an'],
  [UI, ".concat(g && g.sprachwahl ? [['S', T.training.eingabe, 'trainingSprache']] : [],", ".concat(true ? [['S', T.training.eingabe, 'trainingSprache']] : [],", 'K4: „S Eingabe“ auch bei Fliegen'],
  [UI, "txtSp(c, fit(tx.name.toUpperCase(), w - 16, 1), x + 8, y + 28, MF.dim, MS.name.sp);", "txtSp(c, fit(tx.name.toUpperCase(), w - 16, 1), x + 8, y + 31, MF.dim, MS.name.sp);", 'K5: gesperrte Kachel sitzt wieder 3 px tiefer'],
  [UI, "txt(c, fit(T.training.kacheln[g.id].name.toUpperCase(), TD.w - 220, MS.detail.skala)", "txt(c, fit(label(g.modus).toUpperCase(), TD.w - 220, MS.detail.skala)", 'K6: Titel wieder „TRAINING FLIEGEN“'],
  [PT, "sonst: 'B zurück · Esc schließt',", "sonst: 'B zurück · Esc zu',", 'K3: Kopfzeile wieder „Esc zu“'],
  [PT, "      { aktion: 'captain.bot.sprung', key: 'nav.sprung:ziel=marke', fn: 'nav' },", '', 'S4: Sprung fehlt in der Crew-Zeile'],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); aufraeumen(); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { aufraeumen(); process.exit(0); }
}

const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
const basis = lauf();
console.log(`  Ausgangslage ${TEST}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); aufraeumen(); process.exit(1); }
let gelaufen = 0, erkannt = 0, ueberlebt = 0, abstuerze = 0;
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  const fz = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
  if (r.status === 0) { ueberlebt++; console.log(`  UEBERLEBT  ${was}`); }
  else if (fz.length) { erkannt++; console.log(`  erkannt    ${was}  <- ${fz[0].trim().slice(0, 110)}`); }
  else { abstuerze++; console.log(`  ABSTURZ    ${was}  (Exit ${r.status}, zählt nicht)  ${((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error/.test(l))[0] || ''}`.slice(0, 220)); }
  fs.writeFileSync(f, orig);
}
aufraeumen();
console.log(`\nMUTATION-TRAINING-NACHARBEIT2: ${gelaufen} Mutationen, erkannt ${erkannt}, überlebt ${ueberlebt}, Abstürze ${abstuerze}`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
