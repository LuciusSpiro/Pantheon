'use strict';
// BOT-02 B4: Mutationsprobe zu tools/test-bot02-ansagen.js (Ansagen des Bord-Bots). Kopiert Server, Shared, Content, public und die Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt,
// dass der Test rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
// Abschnitt 8 des Tests (Hash gegen den Basisstand per git archive) braucht das Repo; in der Kopie ist er mit ANSAGEN_OHNE_BASIS=1 aus (die ODA-Mutationen faellt schon Abschnitt 2).
//   node tools/mutation-bot02-ansagen.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-ansagen-'));
const ende = (code) => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(code); };
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['tools/test-bot02-ansagen.js', 'tools/bot-clips.js', 'tools/mess-bot02-menschenpartie.js', 'package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
if (fs.existsSync(path.join(ROOT, 'tools', 'lib'))) kopiere('tools/lib');
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const AN = 'server/bots/ansagen.js', AW = 'server/sim/away.js', WE = 'server/bots/weichen.js', MA = 'server/bots/mannschaft.js', AK = 'server/sim/anker.js', HU = 'public/js/hud.js', BM = 'public/js/bot-menue.js', BS = 'public/js/bot-sprache.js', TX = 'content/bots/texte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [AN, "if (jetzt - e.letzte < ABSTAND_S) continue;", "", '8-s-Grenze je Empfaenger weg (Flut)'],
  [AN, "if (letzt != null && jetzt - letzt < WIEDERHOLUNG_S) {", "if (false) {", '30-s-Regel weg (dieselbe Meldung wieder)'],
  [AN, "!(Combat.gesehenVonSpieler(game, p, d) && imBild(game, p, d))", "!imBild(game, p, d)", 'auch Gegner in Sicht des Menschen werden angesagt'],
  [AN, "!(Combat.gesehenVonSpieler(game, p, d) && imBild(game, p, d))", "!Combat.gesehenVonSpieler(game, p, d)", 'gesehene Gegner ausserhalb des Bildausschnitts werden nicht angesagt'],
  [AN, "const out = (game.away.drones || []).filter((d) => d.alive !== false);", "const out = (game.away.drones || []).filter((d) => d.alive !== false && d.vis);", 'nur Gegner mit vis (alte Regel: die Kommandokarte zeigt aber alle lebenden)'],
  [AN, "const out = (game.away.drones || []).filter((d) => d.alive !== false);", "const out = (game.away.drones || []).slice();", 'auch tote Gegner werden angesagt'],
  [AN, "  for (const r of Kreatur.snap(game) || []) out.push({ id: 'K' + r[0], x: r[2], y: r[3] });\n", "", 'Kreaturen fehlen in der Quelle'],
  [AN, "return Math.abs(dx) <= BILD.seite * f && dy >= -BILD.nord * f && dy <= BILD.sued * f;", "return Math.abs(dx) <= BILD.seite * f && dy >= -BILD.sued * f && dy <= BILD.nord * f;", 'Bildausschnitt: Norden und Sueden vertauscht'],
  [AN, "return Math.abs(dx) <= BILD.seite * f && dy >= -BILD.nord * f && dy <= BILD.sued * f;", "return Math.abs(dx) <= 10 && dy >= -BILD.nord * f && dy <= BILD.sued * f;", 'Bildausschnitt seitlich nur 10 Kacheln (kleiner als der Voxel-Client)'],
  [AN, "  if (!hatKommandokarte(game)) return [];\n", "", 'Handkarte (Plattform) sagt Gegner an'],
  [AN, "Combat.scanQuality(game, game.away) < 1", "false", 'gestoerter Scan nennt trotzdem die Entfernung'],
  [AN, "(erst ? 'Scan gestört: etwa ' : 'Etwa ')", "(erst ? 'Scan klar: etwa ' : 'Etwa ')", 'gestoerter Scan: Text sagt nicht, dass der Scan gestoert ist'],
  [AN, "'Zweites Schloss im ' + kompass(p, r.partner)", "'Zweites Schloss im ' + kompass(r.partner, p)", 'Raetselhinweis: Richtung vom Schloss zum Menschen statt umgekehrt'],
  [AN, "if (r.solo) return (ort ||", "if (!r.solo) return (ort ||", 'Raetselhinweis: solo und Gruppe vertauscht'],
  [AN, "'dann innerhalb von ' + Math.floor(r.fenster || 0) + ' Sekunden.'", "'dann innerhalb von 15 Sekunden.'", 'Raetselhinweis: festes Fenster statt das des Servers'],
  [AK, "return q && zustandIn(aw, k, q.id) !== 'geloest' ? mitte(q) : null;", "return q ? mitte(q) : null;", 'Raetselhinweis nennt den Ort eines schon geloesten Gegenstuecks'],
  [AN, "if (!neu && !zahl) return null;", "", 'Gegner: auch ohne Neuzugang oder geaenderte Zahl wieder melden'],
  [AN, "|| !away.odaCodeHelp || away.kustodenpult.disabled || e.codeDone.has(tab)) return null;", "|| !away.odaCodeHelp || away.kustodenpult.disabled) return null;", 'Codefolge mehrfach je Karte'],
  [AN, "if (z.codeStart.get(tab) || !away.odaCodeHelp", "if (!away.odaCodeHelp", 'Codefolge auch, wenn die Hilfe schon vor dem Dienst da war'],
  [AN, "!away.odaCodeHelp || away.kustodenpult.disabled", "away.kustodenpult.disabled", 'Codefolge schon vor dem Ereignis der ODA'],
  [AN, "if (!r || e.raetsel.has(r.paar)) return null;", "if (!r) return null;", 'Raetselhinweis mehrfach je Paar'],
  [AN, "Math.atan2(q.x - p.x, p.y - q.y)", "Math.atan2(q.x - p.x, q.y - p.y)", 'Himmelsrichtung: Norden und Sueden vertauscht'],
  [AN, "const m = px / Physics.TILE;", "const m = px;", 'Entfernung in Pixeln statt Meter'],
  [AN, "return t.length > MAX_ZEICHEN ?", "return false ?", 'Texte nicht auf 90 Zeichen begrenzt'],
  [AN, "if (!game || game.phase !== 'play' || !bot || !game.away || !game.away.active) return;", "if (!game || !bot || !game.away) return;", 'Ansagen auch ohne laufende Partie oder Aussenmission'],
  [AN, "botId: null, befehl: BEFEHL,", "botId: bot.botId, befehl: BEFEHL,", 'Ansage traegt eine botId (wuerde als Antwort eines Bots gelten)'],
  [AN, "[artCode(game, z, e, p), artGegner(game, z, e, p, jetzt), artRaetsel(game, z, e, p)].filter(Boolean).sort((x, y) => e.zuletzt[x.art] - e.zuletzt[y.art])[0]", "[artCode(game, z, e, p), artGegner(game, z, e, p, jetzt), artRaetsel(game, z, e, p)].filter(Boolean)[0]", 'feste Rangfolge: der Raetselhinweis verhungert in einer Gegner-Flut'],
  [MA, "    Ansagen.tick(this.game, this.spieler);   // BOT-02 B4: Ansagen", "    // BOT-02 B4: Ansagen", 'Einhaengepunkt weg: nie eine Ansage'],
  [MA, "    this.zustandSetzen(Station.stationOf(live) === this.stationKind ? 'an_station' : 'unterwegs');\n    if (!this.enter(S, this.stationKind)) return;", "    Ansagen.tick(this.game, this.spieler);\n    this.zustandSetzen(Station.stationOf(live) === this.stationKind ? 'an_station' : 'unterwegs');\n    if (!this.enter(S, this.stationKind)) return;", 'Ansagen auch ausserhalb des Bord-Dienstes (jeder Bot)'],
  [AW, "if (!BotWeichen.bordBotHaelt(game)) game.oda(", "if (true) game.oda(", 'ODA schweigt nicht, obwohl der Bord-Bot die Codefolge ansagt'],
  [WE, "function bordBotHaelt(game) { return require('./lauf.js').bordDienstHaelt(game); }", "function bordBotHaelt(game) { return true; }", 'ODA schweigt immer (auch ohne Bord-Bot, reine Menschenpartie)'],
  [WE, "function bordBotHaelt(game) { return require('./lauf.js').bordDienstHaelt(game); }", "function bordBotHaelt(game) { return !!require('./lauf.js').bordBot(game); }", 'ODA schweigt, sobald ein Bord-Bot existiert (auch ohne laufenden Dienst)'],
  [AK, "if (Math.hypot(c.x - p.x, c.y - p.y) <= kacheln * TILE)", "if (true)", 'Raetselhinweis auch weit vom Schloss'],
  [AK, "if (a.rolle !== 'raetsel' || zustandIn(aw, k, a.id) === 'geloest') continue;", "if (a.rolle !== 'raetsel') continue;", 'Raetselhinweis auch beim geloesten Paar'],
  [HU, "sprechMax(sp) { return (sp || this.sprech).bots ? 3 : 2; },", "sprechMax(sp) { return 3; },", 'Sprechspalte: auch ohne Bots 3 Untertitel'],
  [HU, "sprechMax(sp) { return (sp || this.sprech).bots ? 3 : 2; },", "sprechMax(sp) { return 2; },", 'Sprechspalte: auch mit Bots nur 2 Untertitel'],
  [BM, "msg.befehl === 'bord.ansage' ? 'bord' : rolle ||", "rolle ||", 'Menue: Sprecher der Ansage nicht BORD'],
  [BS, "if (!s.aufnahme && msg.textId && msg.befehl !== 'bord.ansage') {", "if (!s.aufnahme && msg.textId) {", 'Sprache: auch die Ansage sucht einen Clip'],
  [TX, '"Orbit meldet: {LAGE}"', '"Orbit meldet: {LAGE} {LAGE} {LAGE}"', 'Vorlage zu lang (Hoechstfall ueber 90 Zeichen)'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const normal = (t) => t.replace(/\r\n/g, '\n');
{
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); ende(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) ende(0);
}

const lauf = () => spawnSync(process.execPath, ['tools/test-bot02-ansagen.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { ANSAGEN_OHNE_BASIS: '1' }) });
let erkannt = 0, gelaufen = 0, ueberlebt = 0, abstuerze = 0;
console.log(`Mutationsprobe Ansagen des Bord-Bots (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf();
  console.log(`  Ausgangslage: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n') + (basis.stderr || '').slice(0, 400)); ende(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const pfad = path.join(TMP, datei);
  const original = fs.readFileSync(pfad, 'utf8');
  fs.writeFileSync(pfad, normal(original).replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(pfad, original);
  const rot = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (r.status === 1 && rot.length) { erkannt++; console.log(`  erkannt   ${was}  [${rot[0].trim().slice(0, 100)}]`); }
  else if (r.status === 0) { ueberlebt++; console.log(`  UEBERLEBT ${was}`); }
  else { abstuerze++; console.log(`  ABSTURZ   ${was} (Exit ${r.status}) ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || ''}`); }
}
console.log(`\n${erkannt} von ${gelaufen} Mutationen erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Abstuerze`);
ende(ueberlebt || abstuerze ? 1 : 0);
