'use strict';
// SUND-04a-2 P2: Mutationsprobe zu den Bitten der Geschichtsfaeden (tools/test-faden-bitte.js, tools/test-ui-bitte.js, tools/test-faden-bitte-ws.js). Kopiert Server, Shared, Content, Client-Module und die Tests
// in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit 1 mit FEHLER-Zeile). Überlebt eine Mutation, deckt
// kein Test die Regel ab. ABSTÜRZE (Exit ungleich 0 und 1 oder Exit 1 ohne FEHLER-Zeile, z. B. eine Ausnahme beim Laden) zählen NICHT als erkannt: sie zeigen nur, dass etwas kaputt ist, nicht dass
// eine Regel geprüft wird. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prüft nur die Anker.
//   node tools/mutation-faden-bitte.js [--trocken] [begriff …]      (npm run test:faden-bitte-mutation)
// Bewusst nicht abgedeckt: das Zeichnen selbst (Pixel) und die Tasten-Verdrahtung in client.js (Sichtprüfung: tools/sicht-bitte.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-bitte-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-bitte.js'], ['tools/test-ui-bitte.js'], ['tools/test-faden-bitte-ws.js']];
for (const f of [...TESTS.map((t) => t[0]), 'tools/regie-fixture.js', 'tools/faden-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const BI = 'server/sim/faden-bitte.js', FD = 'server/sim/faden.js', GA = 'server/game.js', PR = 'shared/protocol.js', FW = 'public/js/funkwahl.js', HU = 'public/js/hud.js',
  FA = 'server/sim/funk-antwort.js', RE = 'server/sim/reise-ereignis.js', BA = 'server/sim/faden-bausteine.js', BW = 'content/faeden/bitte-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Welle 5: Ton des Funks (M1), Porträt-Farben (S7), Punkt-Kappe (S9), Porträt-Abstand (K4), Farben aus KarteTokens (K5)
  [HU, "(f.fd === 1 || f.ton === 'meldung')", "(f.fd === 1)", 'Akzent: ton meldung bleibt Rot (M1)'],
  [HU, "ton: ton === 'meldung' || ton === 'gefahr' ? ton : '' };", "ton: ton || '' };", 'Müll als ton wird übernommen (M1)'],
  ['public/js/karte-lage.js', "ton: ev.ton === 'meldung' ? 'meldung' : '' });", "ton: '' });", 'Funk-Reiter merkt ton nicht (M1)'],
  ['public/js/client.js', "ev.fd, ev.ton);", "ev.fd);", 'client.js reicht ton nicht durch (M1)'],
  ['public/js/consoles.js', "e.fd === 1 || e.ton === 'meldung' ? KarteTokens", "e.fd === 1 ? KarteTokens", 'Funk-Reiter färbt ton meldung Rot (M1)'],
  [HU, "FARBE = window.KarteTokens ? window.KarteTokens.FARBE.fraktion[{ rom: 'r', ger: 'g', kon: 'k' }[fr]].flaeche : { rom: '#6B2E2E', ger: '#3F4A28', kon: '#4A4466' }[fr];", "FARBE = { rom: '#7A2420', ger: '#4D5A3A', kon: '#2D4F6E' }[fr];", 'Porträt mit festen Fraktionsfarben (S7)'],
  [FW, "if (punkt) { ctx.fillStyle = SK.text; ctx.fillRect(sx + tw + (vor ? 1 : 0), y + 5, 2, 2); }", "if (punkt) R.text(ctx, '.', sx, y, { color: SK.text, shadow: false });", 'Punkt-Kappe als Glyph (S9)'],
  [FW, "const BILD_X = 7, BILD_PLATZ = 29;", "const BILD_X = 5, BILD_PLATZ = 27;", 'Porträt 2 px weiter außen (K4)'],
  [FW, "text: PU.hell || '#F4EEDC'", "text: '#F4EEDC'", 'SK.text fest statt KarteTokens (K5)'],

  // ---- Angebot: Prüfer, Gefahr, unruhig, Angebot schon offen, Ausgang-Regel
  [BI, '  if (fehler.length) {', '  if (false) {', 'Angebot: Scheinwahl und Optionsfehler werden nicht geprüft'],
  [BI, "  if (B[beat.typ].gefahr || beat.gefahr === true) return { ok: false, code: 'gefahr' };", '', 'Angebot: auch bei Gefahr'],
  [BI, "  if (!FA().ruhig(game)) return { ok: false, code: 'unruhig' };", '', 'Angebot: auch in unruhiger Lage'],
  [BI, "  if (F.bitte) return { ok: false, code: 'schon_offen' };", '', 'Angebot: mehr als eine Bitte gleichzeitig'],
  [BI, 'if (ohneAusgang.length) {', 'if (false) {', 'Angebot: Option mit Folge ohne Ausgang wird angeboten (Beat bliebe offen)'],
  [BI, "  if (game.weltsim.funkwahl && game.weltsim.funkwahl.offen) return { ok: false, code: 'funk_offen' };", '', 'Angebot: neben einer Funk-Antwort'],
  // ---- Deckel
  [BI, '  const erlaubt = opts;   // Welle 3:', '  const erlaubt = opts.filter((x) => rufBetrag(x.folge) <= 1e-9 || rufBetrag(x.folge) <= deckelRaum(F) + 1e-9);   // Welle 3:', 'Deckel: Optionen mit Ruf-Folge entfallen aus dem Angebot (Welle 3: der Deckel nimmt nie eine Option weg)'],
  [FD, '  folgenAnwenden(game, f, opt.folge, true);   // Welle 3:', '  folgenAnwenden(game, f, opt.folge, false);   // Welle 3:', 'Deckel: die Folge der Option geht am Deckel vorbei (Ruf nicht begrenzt)'],
  [BI, '  F.bitteLog = F.bitteLog.filter((x) => F.t - x[0] < BW.fenster_taetigkeiten);', '', 'Deckel: läuft nie ab'],
  [FD, '      if (r && r.ok && r.angewandt > 0) F.bitteLog.push([F.t, b]);', '      if (r && r.ok && r.angewandt > 0) { /* nicht gezaehlt */ }', 'Deckel: der Betrag wird nicht gebucht'],
  // ---- Antwort: erste gilt, Nummer, Ausgang, Folgen, Funk
  [BI, "  if (!off) return fehl(F.bitteZuletzt && nr === F.bitteZuletzt.nr ? 'schon_beantwortet' : 'kein_angebot');", "  if (!off) return fehl('kein_angebot');", 'Antwort: „schon beantwortet“ fehlt (die erste gilt nicht)'],
  [BI, '  F.bitteZuletzt = { nr: off.nr };', '', 'Antwort: die erste Antwort wird nicht festgehalten'],
  [BI, "  if (nr != null && nr !== off.nr) return fehl('kein_angebot');", '', 'Antwort: die Nummer des Angebots zählt nicht'],
  [BI, "  if (!FA().ruhig(game)) { F.bitte = null; return fehl('unruhig'); }", '', 'Antwort: auch in unruhiger Lage'],
  [BI, "  if (!f || f.phase !== 'laeuft' || !f.laufend || f.laufend.beat !== off.beatId || f.laufend.gewaehlt) { F.bitte = null; return fehl('kein_angebot'); }", '', 'Antwort: für einen verlaufenen Beat'],
  [BI, 'funkSenden(game, BW.antwort_von, opt.text);   // die Crew antwortet', 'void 0;   // die Crew antwortet', 'Antwort: die Antwort der Crew fehlt im Funk'],
  [BI, 'optionWaehlen(game, off.fadenId, opt.id);', 'optionWaehlen(game, off.fadenId, "zusagen");', 'Antwort: es wird immer die erste Option gewählt'],
  // ---- Verfall, Wiederholung, Takt, Hinweis
  [BI, '    else if (F.t >= off.bis && Faden().spielleiterAktiv(game)) {', '    else if (F.t >= off.bis + 100 && Faden().spielleiterAktiv(game)) {', 'Verfall: viel zu spät'],
  [BI, '    else if (F.t >= off.bis && Faden().spielleiterAktiv(game)) {', '    else if (F.t >= off.bis) {', 'Verfall: läuft auch ohne aktiven Spielleiter ab (Nacharbeit L9)'],
  [BI, "      Faden().beatAusgang(game, off.fadenId, 'gescheitert');", '      void 0;', 'Verfall: der Beat gilt nicht als gescheitert'],
  [BI, '  for (const f of F.liste.slice()) {   // ein laufender', '  for (const f of []) {   // ein laufender', 'Wiederholung: eine Bitte wird nach unruhiger Lage nicht erneut angeboten'],
  [BI, '  if (F && F.bitte && !FA().ruhig(game)) F.bitte = null;', '  if (false) F.bitte = null;', 'Takt: unruhige Lage zieht das Angebot nicht zurück'],
  [BI, '  for (const h of beat.hinweise || []) Hinweis().senden(game, f.id, h);', '', 'Hinweis: wird nicht mit dem Angebot gesendet und bestätigt (B-S1)'],
  [FD, "  try { require('./faden-bitte.js').nachTaetigkeit(game); } catch (e) { fehlerZaehlen(game, 'faden-bitte', e); }", '', 'Takt: der Verfall läuft nicht (kein Hook in faden.taetigkeit)'],
  [RE, "require('./faden-bitte.js').update(game);", 'void 0;', 'Takt: kein Hook in reise-ereignis.update'],
  [FA, '  if (game.weltsim.faeden && game.weltsim.faeden.bitte) return null;', '', 'Funk-Antwort: eine offene Bitte verdrängt die Funk-Antwort nicht (zwei Leisten)'],
  [BA, "registriere('bitte', require('./faden-bitte.js').baustein);", '', 'Baustein: die Bitte ist nicht registriert'],
  // ---- Weltstand: Speichern, Laden, Müll
  [FD, '  if (bt) b.bitte = bt;', '', 'Weltstand: die offene Bitte wird nicht gespeichert'],
  [FD, "  if (bt) { F.bitte = bt; F.bitteNr = bt.nr; } else if (istObjekt(b.bitte)) F.ladeFehler.push('bitte: verworfen');", '', 'Weltstand: die offene Bitte wird beim Laden verworfen'],
  [BI, 'optionen.push({ id: x.id, text: x.text, folge: klon(quelle.folge), ausgang: quelle.ausgang });', 'optionen.push({ id: x.id, text: x.text, folge: [], ausgang: quelle.ausgang });', 'Weltstand: Folgen kommen nicht aus der Vorlage'],
  [BI, '  if (!Number.isInteger(b.rest) || b.rest < 0 || b.rest > BW.frist_taetigkeiten) return null;', '', 'Weltstand: Müll (Rest zu groß) wird nicht verworfen'],
  [BI, "  if (!Array.isArray(b.optionen) || b.optionen.length < BW.optionen.min || b.optionen.length > BW.optionen.max) return null;", '', 'Weltstand: Müll (Optionen) wird nicht verworfen'],
  // ---- Nacharbeit Welle 1: Bitten-Deckel im Weltstand (L10), Ruhe bei Faden-Gefahr (L11)
  [FD, '  if (dk) b.deckel = dk;', '', 'Weltstand: der Zähler des Bitten-Deckels wird nicht gespeichert'],
  [FD, "F.bitteLog = require('./faden-bitte.js').lesenDeckel(b.deckel, F.t);", 'F.bitteLog = [];', 'Weltstand: der Zähler des Bitten-Deckels wird nicht gelesen'],
  [BI, 'Number.isFinite(x[1]) && x[1] > 0 && x[1] <= DECKEL_BETRAG_MAX', 'Number.isFinite(x[1])', 'Weltstand: der Deckel-Leser nimmt Müllbeträge'],
  [BI, 'x[0] <= t && t - x[0] < BW.fenster_taetigkeiten &&', 'true &&', 'Weltstand: der Deckel-Leser nimmt Einträge aus der Zukunft und ausserhalb des Fensters'],
  [BI, '.map((x) => [x[0], x[1]]).slice(-DECKEL_MAX);\n}', '.map((x) => [x[0], x[1]]);\n}', 'Weltstand: der Deckel-Leser klemmt die Zahl der Einträge nicht'],
  [BI, 'const l = ((F && F.bitteLog) || []).filter((x) => Array.isArray(x) && t - x[0] < BW.fenster_taetigkeiten);', 'const l = ((F && F.bitteLog) || []).filter((x) => Array.isArray(x));', 'Weltstand: abgelaufene Deckel-Einträge werden mitgeschrieben'],
  [FA, '  if (game.fadenSzene) return false;   // SUND-04a-2 Nacharbeit L11', '', 'Ruhe: eine angekündigte Faden-Gefahr (Vorlauf) gilt als ruhig'],
  // ---- Befehl, Snapshot, Protokoll
  [GA, "      else if (!bk && this.sentBittenKey) { world.bitte = null; this.sentBittenKey = null; }", '      else if (false) { world.bitte = null; this.sentBittenKey = null; }', 'Snapshot: kein Löschsignal für die Bitte'],
  [GA, '      if (bk && bk !== this.sentBittenKey && !includeAsteroids', '      if (bk && !includeAsteroids', 'Snapshot: die Bitte geht in jedem Snapshot mit (nicht nur bei Änderung)'],
  [GA, "kind: 'fadenBitteAntwort', pid: p.id, ok: !r }", "kind: 'fadenBitte', pid: p.id, ok: !r }", 'Befehl: die Antwort kommt unter einem anderen Ereignisnamen an'],
  [PR, "    CMD_FADEN_BITTE: 'faden.bitte',", "    CMD_FADEN_BITTE: 'faden.bitte2',", 'Protokoll: anderer Befehlsname'],
  // ---- Porträt
  [BI, "const pidGueltig = (pid) => typeof pid === 'string' && PID_RE.test(pid);", "const pidGueltig = (pid) => typeof pid === 'string';", 'Porträt: jede Zeichenkette gilt'],
  [BI, "  return 'f:' + Faden().portraetVon(npc) + ':' + npc.fraktion;", "  return 'f:' + 6 + ':' + npc.fraktion;", 'Porträt: Variante außerhalb der sechs'],
  [HU, "      const m = typeof pid === 'string' ? /^f:([0-5]):(rom|ger|kon)$/.exec(pid) : null;", "      const m = /^f:([0-9]):(rom|ger|kon)$/.exec(String(pid));", 'Porträt-Zeichnung: Variante 6 bis 9 wird gezeichnet'],
  // ---- Client: Leiste
  [FW, "const PID_F = /^f:[0-5]:(rom|ger|kon)$/;", 'const PID_F = /^f:.*$/;', 'Client: jede Porträt-Kennung wird angenommen'],
  [FW, "      if (id === '__zuklappen') { spaeter(true); return true; }", '', 'Client: Später schickt einen Befehl statt zuzuklappen'],
  [FW, "[{ id: m.art === 'bitte' ? '__zuklappen' : 'ignorieren', text: m.ignorieren }]", "[{ id: 'ignorieren', text: m.ignorieren }]", 'Client: Später fehlt bei der Bitte'],
  [FW, "      send({ t: 'cmd', c: 'faden.bitte', id, nr: m.nr });", "      send({ t: 'cmd', c: 'faden.bitte', id });", 'Client: die Nummer des Angebots fehlt im Befehl'],
  [FW, "  const kopfH = (m) => (m && m.art === 'bitte' && m.pid ? 26 : KOPF);", '  const kopfH = (m) => KOPF;', 'Client: die Kopfzeile mit Porträt ist nicht höher'],
  [FW, "  const modell = () => store.bitte || modellAus(store.funkwahl);", '  const modell = () => modellAus(store.funkwahl);', 'Client: die Bitte wird nicht angezeigt'],
  // ---- Daten
  [BW, '"wert": 4,', '"wert": 9,', 'Daten: Verfall nach neun Tätigkeiten (über der Frist des Beats)'],
  [BW, '"wert": 0.25,', '"wert": 5,', 'Daten: Bitten-Deckel viel zu hoch'],
];

// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie). Sonst bricht die Probe mit Exit 2 ab.
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
// rot = ein Test hat eine Prüfung verfehlt (Exit 1 mit FEHLER-Zeile); alles andere (Absturz, Zeitlimit) ist KEIN Beleg
const einstufung = (r) => {
  if (r.status === 0) return 'gruen';
  const text = (r.stdout || '') + (r.stderr || '');
  if (r.status === 1 && text.split('\n').some((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l))) return 'rot';   // eine Ausnahme (ABSTURZ Ausnahme) ist nie ein Beleg
  return 'absturz';
};
let ueberlebt = 0, abstuerze = 0, gelaufen = 0;
console.log(`Mutationsprobe Bitten der Geschichtsfäden (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  const e = einstufung(basis);
  console.log(`  Ausgangslage ${t.join(' ')}: ${e === 'gruen' ? 'grün' : 'ROT oder Absturz (Abbruch)'}`);
  if (e !== 'gruen') { console.log(((basis.stdout || '') + (basis.stderr || '')).split('\n').filter((l) => /FEHLER|Error/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig (${datei})`); ueberlebt++; continue; }
  const neuerText = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? neuerText.replace(/\n/g, '\r\n') : neuerText);
  let wer = null, stufe = 'gruen', r = null;
  for (const t of TESTS) {
    r = lauf(t);
    const e = einstufung(r);
    if (e === 'rot') { wer = path.basename(t[0], '.js').replace('test-', ''); stufe = 'rot'; break; }
    if (e === 'absturz') { stufe = 'absturz'; wer = path.basename(t[0], '.js').replace('test-', ''); break; }
  }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
  if (stufe === 'rot') console.log(`  rot   ${was} (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || '').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`);
  else if (stufe === 'absturz') { abstuerze++; ueberlebt++; console.log(`  ABSTURZ ${was} (${wer}: Exit ${r.status}, zählt NICHT als erkannt: ${((r.stderr || r.stdout || '').split('\n').find((l) => /Error|FEHLER/.test(l)) || '').slice(0, 80)})`); }
  else { ueberlebt++; console.log(`  GRÜN  ${was}  <-- ÜBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
const erkannt = gelaufen - ueberlebt;
console.log(`${erkannt} von ${gelaufen} Mutationen erkannt` + (abstuerze ? ` (${abstuerze} Absturz, nicht gezählt)` : '') + (ueberlebt ? `, ${ueberlebt} überlebt oder abgestürzt` : ''));
process.exit(ueberlebt ? 1 : 0);
