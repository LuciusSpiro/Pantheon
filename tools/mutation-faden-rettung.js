'use strict';
// BEA-02 B: Mutationsprobe zu tools/test-faden-rettung.js (Beat rettung: Ausgangsbedingung, Frachtraum-Hinweis, Pflicht landeplatz, Besetzung nach Variante, Abraeumen, Filter nach person, Doppelereignis, Notsprung,
// Notrueckholung, Namen, Daten). Kopiert Server, Shared, Content, public und die noetigen Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird
// (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-rettung.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-rettung-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-rettung.js']];
for (const f of ['tools/test-faden-rettung.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FR = 'server/sim/faden-rettung.js', RA = 'server/sim/faden-boden-rahmen.js', PR = 'server/sim/faden-pruefer.js', FA = 'server/sim/faden.js', RE = 'server/sim/reise-ereignis.js', BT = 'content/faeden/beats.json', AM = 'server/sim/abenteuer-mock.js', WT = 'content/faeden/rettung-werte.json', B1 = 'content/faeden/b1-texte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // Ausgangsbedingung
  [FR, "if (zs.every((z) => erledigt.includes(z))) return 'gelungen';", "if (zs.some((z) => erledigt.includes(z))) return 'gelungen';", 'Ausgang gelungen: schon eine Person genuegt statt aller'],
  [FR, "const erledigt = uebergabe ? ['uebergeben', 'ohne_bett'] : [", "const erledigt = uebergabe ? ['uebergeben', 'ohne_bett', 'im_lager'] : [", 'Ausgang ende abgegeben: eine Person im Lager zaehlt schon als abgegeben'],
  [FR, "return weiter ? null : 'gescheitert';", 'return null;', 'Scheitern ohne Weg: keine Ueberlebende mehr erreichbar wird nicht erkannt'],
  [FR, "if (ev.name === 'npcRescued') { merke(f, 'aufgenommen', String(d.person)); return; }", "if (ev.name === 'npcRescued') { merke(f, 'aufgenommen', String(d.person)); pruefenBeat(game, f, beat, lp); return; }", 'Doppelereignis: npcRescued bewertet schon (die Person liegt noch nicht im Lager)'],
  [FR, "if (n && n.rescued) return 'ohne_bett';", "if (n && n.rescued) return 'unten';", 'Gerettet-Weg der Karte (ohne Bett) wird nicht als erledigt erkannt'],
  [FR, "if (Bord().personAnBord(game, p.person)) return 'im_lager';", "if (Bord().personAnBord(game)) return 'im_lager';", 'Filter nach person: jede Person im Lager (auch eine fremde) zaehlt als an Bord'],
  // Frachtraum-Hinweis
  [FR, 'if (!platz.ok) {   // nichts raeumen', 'if (false) {   // nichts raeumen', 'Frachtraum-Hinweis: kein Funk bei belegtem Frachtraum'],
  [FR, 'if (platz.text && game.oda) game.oda(platz.text, null);', '', 'Frachtraum-Hinweis: die Bordanzeige nennt den Klartext nicht'],
  // Pflicht landeplatz
  [BT, '"frist": 16,\n      "braucht": {"nsc_status": ["aktiv", "verbuendet", "gefangen"], "landeplatz": true},', '"frist": 16,\n      "braucht": {"nsc_status": ["aktiv", "verbuendet", "gefangen"]},', 'Pflicht landeplatz: der Katalog verlangt sie nicht mehr (Pruefer und Expander lassen den Beat ohne Ort zu)'],
  [PR, 'if (braucht.landeplatz === true && !(typeof p.landeplatz', 'if (false && braucht.landeplatz === true && !(typeof p.landeplatz', 'Pflicht landeplatz: Pruefer-Regel aus'],
  // Besetzung nach Variante
  [RA, 'const besetzungVon = (beat) => WERTE.besetzung.wert[besetzungsSchluessel(beat)];', 'const besetzungVon = () => WERTE.besetzung.wert[WERTE.besetzung_standard.wert];', 'Besetzung nach Variante: immer die Standardbesetzung (ruhig)'],
  [FR, '    Landung.besetzenFuer(game, beat, lp, ART);\n    ueberlebendeSetzen(game, faden, beat, lp);', '    ueberlebendeSetzen(game, faden, beat, lp);', 'Besetzung: der Beat besetzt den Ort beim Start nicht'],
  [BT, '"parameter":{"landeplatz":{"erlaubt":"landeplatz"},"besetzung":{"standard":"ruhig","erlaubt":["ruhig","raeuber","belagerer"]},"ende"', '"parameter":{"landeplatz":{"erlaubt":"landeplatz"},"besetzung":{"standard":"ruhig","erlaubt":["ruhig","raeuber"]},"ende"', 'Katalog: erlaubte Besetzungen weichen von der Tabelle ab (rettung nennt belagerer nicht)'],
  // Abraeumen
  [FA, "try { require('./abenteuer-orte.js').abraeumen(game, f.id); } catch (e) { fehlerZaehlen(game, 'abenteuer-orte-ende', e); }", '', 'Abraeumen: der Aufruf im Faden-Abschluss fehlt (nur der Takt raeumt spaeter)'],
  // Notsprung und Notrueckholung
  [FR, "if (ev.name === 'notsprung') { ausgang(game, f, 'gescheitert'); return; }", '', 'Notsprung im Beat: der Handler reagiert nicht'],
  [FR, 'if (d.map !== lp || d.notrueckholung !== true || !Landung.niemandUnten(game, lp)) return;', 'if (d.map !== lp || !Landung.niemandUnten(game, lp)) return;', 'Notrueckholung: der Marker wird ignoriert (jedes Hochbeamen mit Ueberlebenden unten scheitert)'],
  [FR, "if (d.map !== lp || d.notrueckholung !== true || !Landung.niemandUnten(game, lp)) return;\n      if (zustaende(game, f, beat, lp).some((z) => z === 'unten')) ausgang(game, f, 'gescheitert');", "if (d.map !== lp || d.notrueckholung !== true || !Landung.niemandUnten(game, lp)) return;\n      ausgang(game, f, 'gescheitert');", 'Notrueckholung: scheitert auch, wenn keine Ueberlebenden mehr am Boden sind'],
  [FR, 'Boden.anmelden(ART, handler);', '', 'Handler nicht am Verteiler angemeldet'],
  // Takt
  [RE, "try { require('./faden-rettung.js').update(game); }", 'try { void 0; }', 'Haken im Tick (reise-ereignis.update) fehlt: Ueberlebende kommen nach einem Neubau der Karte nie zurueck'],
  // Ueberlebende
  [FR, "{ person: p.person, name: p.name, injured: false }", "{ person: p.person, name: p.name, injured: true }", 'Ueberlebende sind verletzt (injured true statt false)'],
  [FR, "namen: [f.nsc.name].concat(Faden().ueberlebendeNamen(game, f, n - 1))", "namen: [f.nsc.name].concat(Faden().ueberlebendeNamen(game, f, n))", 'Anzahl: eine Person zu viel (Beat hat n + 1 Personen)'],
  [FR, 'return Math.max(WERTE.anzahl_min.wert, Math.min(WERTE.anzahl_max.wert, n));', 'return n;', 'Anzahl wird nicht auf die Grenzen der Daten geklemmt'],
  [FA, "const rng = strom(game, idNr(f.id), 'ueberlebende:' + f.beat);", "for (const l of require('./fracht.js').state(game).lager) if (l && l.name) vergeben.add(l.name);\n  const rng = strom(game, idNr(f.id), 'ueberlebende:' + f.beat);", 'Namen: die Namen im Frachtlager zaehlen mit (nach dem Laden verschieben sich die Namen der Nebenfiguren)'],
  [FA, 'const frei = (t) => !vergeben.has(t) && !out.includes(t);', 'const frei = (t) => !vergeben.has(t);', 'Namen: Doppelte untereinander moeglich'],
  [FA, "const vergeben = require('./abenteuer-kanon.js').namenVergeben(zustandVon(game));\n  vergeben.add(f.nsc.name);", "const vergeben = new Set();\n  vergeben.add(f.nsc.name);", 'Namen: die Namen des Kanons und der Faeden werden nicht ausgeschlossen'],
  // BEA-02 Nacharbeit (Review): Abgabe am Boden, Kennung je Beat, Laden zwischen Abgaben, Fehlerzahl
  [FR, "if (d.abgabe === 'station') {", "if (d.abgabe) {", 'Abgabe am Boden (Landepunkt, keine Station) zaehlt als abgegeben'],
  [FR, "if (d.abgabe === 'boden') {", "if (false) {", 'Am Boden abgesetzt: die Person steht nicht wieder am Ort (Datensatz bleibt gerettet, der Beat gilt als gelungen)'],
  [FR, '`${f.id}.${beat.id}.${WERTE.person_praefix.wert}${i + 1}`', '`${f.id}.${WERTE.person_praefix.wert}${i + 1}`', 'Kennung ohne Beat-Bezug: zwei rettung-Beats eines Fadens teilen die Personen'],
  [FA, 'if (s.length) f.laufend[k] = s;', '', 'Laden: aufgenommen und uebergeben aus f.laufend gehen verloren (Laden zwischen zwei Abgaben)'],
  [FR, "if (hat(f, 'aufgenommen', p.person) || hat(f, 'uebergeben', p.person) ||", "if (", 'Nachsetzen: aufgenommene und abgegebene Personen werden nach dem Laden wieder auf die Karte gesetzt'],
  [FR, "if (meldeEinmal(f, lp + '|' + p.person)) fehlerZaehlen(", 'if (true) fehlerZaehlen(', 'Fehler beim Setzen: jeder Tick zaehlt einen Fehler statt einmal je Person und Karte'],
  // Daten
  [BT, '"zweck": "Ueberlebende finden, an Bord beamen, optional abgeben.",', '"zweck": "Ueberlebende finden, an Bord beamen, optional abgeben, ' + 'mit einer viel zu langen Beschreibung. '.repeat(4) + '",', 'Katalogzeile laenger als 400 Zeichen'],
  [FR, 'if (hi > CONFIG.personen.maxGleichzeitig) out.push(', 'if (false) out.push(', 'Katalogpruefung: anzahl_max ueber CONFIG.personen.maxGleichzeitig wird nicht gemeldet'],
  [FR, "if (p !== '{platz}' && p !== '{ort}' && p !== '{name}') out.push(", "if (false) out.push(", 'Katalogpruefung: ein unbekannter Platzhalter im Text wird nicht gemeldet'],
  [WT, '"wert": 3,\n      "einheit": "Personen",\n      "_hinweis": "So viele', '"wert": 2,\n      "einheit": "Personen",\n      "_hinweis": "So viele', 'Daten: anzahl_standard 2 statt 3 (Katalog und Daten laufen auseinander)'],
  [B1, '"rettung_gelungen": "wiedersehen_rettung_gelungen",', '', 'Wiedersehen: rettung_gelungen steht nicht in wiedersehen_erinnert (die Hauptfigur kehrt nie wieder)'],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Rettung (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
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
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at |Ausnahme/.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
