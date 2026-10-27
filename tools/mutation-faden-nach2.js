'use strict';
// SUND-04a-2 Nacharbeit Welle 2 (Sichtbarkeit und Fairness): Mutationsprobe zu den neuen Tests in tools/test-faden-vorlagen.js (Hinweise gesendet, Tote, Ablehnen, Fracht-Ziel, Texte, Pruefer),
// tools/test-faden-bitte.js (Bitte im Funk, Kuerzel) und tools/test-ui-bitte.js (Bittentext, Ruf-Slot mit Vorrang, ODA, Rahmen, Funk der Faeden). Kopiert Server, Shared, Content, public und die Tests in ein
// Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile,
// Syntaxfehler, Ausnahme beim Laden) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-nach2.js [--trocken] [begriff ...]      (npm run test:faden-nach2-mutation)
// Bewusst nicht abgedeckt: das Zeichnen selbst (Pixel; Sichtpruefung tools/sicht-bitte.js, sicht-funkwahl.js), der Hinweis des Bausteins notruf (keine Vorlage in content/ hat dort einen Hinweis),
// gleichwertige Mutationen (Zielwahl `$ort` ohne zielFuer: laden lehnt den Hex ohnehin ab; Dock-Pruefung in andockbar: auf dieser Karte hat jeder roemische/Konkordat-Hafen einen Liegeplatz).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-nach2-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-ui-bitte.js'], ['tools/test-faden-bitte.js'], ['tools/test-faden-vorlagen.js']];   // die schnellen zuerst (die erste rote Pruefung genuegt)
for (const f of [...TESTS.map((t) => t[0]), 'tools/regie-fixture.js', 'tools/faden-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const HW = 'server/sim/faden-hinweis.js', BI = 'server/sim/faden-bitte.js', FR = 'server/sim/faden-fracht.js', SZ = 'server/sim/faden-szene.js', FD = 'server/sim/faden.js', P3 = 'server/sim/faden-p3.js', PR = 'server/sim/faden-pruefer.js';
const FW = 'public/js/funkwahl.js', HU = 'public/js/hud.js', CL = 'public/js/client.js', KL = 'public/js/karte-lage.js', CO = 'public/js/consoles.js';
const VF = 'content/faeden/vorlagen/falscher_haendler.json', P3T = 'content/faeden/p3-texte.json', BW = 'content/faeden/bitte-werte.json', SW = 'content/faeden/szenen-werte.json', NA = 'content/faeden/namen.json', WE = 'content/faeden/werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- F2: Hinweise werden gesendet
  [HW, "  const z = sprecher === null ? Bitte().funkVon(game, f.nsc, text) : Bitte().funkSprecher(game, sprecher, text);\n  if (!z) return { ok: false, grund: 'Funk nicht gesendet' };", '  const z = true;', 'Hinweis: der Baustein bestaetigt ohne zu senden'],
  [BI, '  for (const h of beat.hinweise || []) Hinweis().senden(game, f.id, h);', '  for (const h of beat.hinweise || []) Faden().hinweisGezeigt(game, f.id, h);', 'Hinweis: die Bitte bestaetigt nur formal (hinweisGezeigt statt senden)'],
  [SZ, '    for (const h of ctx.beat.hinweise || []) Hinweis.senden(game, faden.id, h);   // Nacharbeit F2: der Hinweis (Papiere) wird gesendet, erst dann gilt er', '    for (const h of ctx.beat.hinweise || []) Faden.hinweisGezeigt(game, faden.id, h);', 'Hinweis: die Fracht bestaetigt nur formal (hinweisGezeigt statt senden)'],
  [BI, "{ from: von, text: zeile, lage: 1, fd: 1, r: 1 }", "{ from: von, text: zeile, fd: 1, r: 1 }", 'Funk: Hinweiszeile ohne lage (Konsolen zeigen sie nie)'],
  [BI, '  const ev = { from: nsc.name, text: zeile, lage: 1, fd, r: 1 };', '  const ev = { from: nsc.name, text: zeile, fd, r: 1 };', 'Funk: NSC-Zeile ohne lage (Konsolen zeigen sie nie)'],
  [PR, "    if (typeof t !== 'string' || t.trim().length < 8) fehler.push(", "    if (typeof t !== 'string' || t.trim().length < 0) fehler.push(", 'Pruefer: leerer oder winziger Hinweistext wird nicht abgelehnt'],
  [PR, '    else if (t.length > W.hinweis_text_max) fehler.push(', '    else if (t.length > 100000) fehler.push(', 'Pruefer: Hinweistext beliebig lang'],
  [PR, "    else if ((t.match(/\\{[^}]*\\}/g) || []).some((p) => p !== '{name}' && p !== '{ort}')) fehler.push(", '    else if (false) fehler.push(', 'Pruefer: unbekannter Platzhalter im Hinweistext erlaubt'],
  [PR, '    else if (/^\\{name\\}\\s*:/.test(t)) fehler.push(', '    else if (false) fehler.push(', 'Pruefer: "{name}:" am Anfang des Hinweistextes erlaubt'],
  // ---- F1: die Bitte steht im Funk (Server)
  [BI, '  funkVon(game, { name: ab.name, fraktion: ab.fraktion, portrait: ab.portrait }, F.bitte.text);', '', 'Bitte: kein Funk zur Bitte (sie steht nicht im Funk-Log)'],
  [BI, '  if (BW.kuerzel && BW.kuerzel[o.volk]) s.fk = BW.kuerzel[o.volk];', '', 'Snapshot: kein Kuerzel der Fraktion'],
  // ---- F3: Funk der Faden-NSC, Tote, Gefahr
  [BI, 'const funkGefahrVon = (game, nsc, text) => nscFunk(game, nsc, text, 2);', 'const funkGefahrVon = (game, nsc, text) => nscFunk(game, nsc, text, 1);', 'Notruf mit Gefahr geht in Messing statt Rot'],
  [P3, '    const f = sagenGefahr(game, nsc, text);', '    const f = sagen(game, nsc, text);', 'Notruf: Gefahr nicht als Gefahr gesendet'],
  [P3, "    if (nsc.status === 'tot') Bitte().funkSprecher(", '    if (false) Bitte().funkSprecher(', 'Abschluss: der Tote spricht selbst (eigener Name und Porträt)'],
  [P3, "    const key = nsc.status === 'tot' ? 'abschluss_tot' :", "    const key = false ? 'abschluss_tot' :", 'Abschluss: ein toter NSC bekommt den Dank statt des Totentextes'],
  [P3T, '"abschluss_tot": "{name} ist tot. Der Name bleibt auf den Karten der Crew."', '"abschluss_tot": "{name}: Er ist tot. Ihr habt ihn nicht retten können."', 'Text: Totentext mit Namen davor und er/ihn'],
  [P3T, '"notruf_erinnert_abgelehnt": "Ihr habt mich damals abgewiesen. Jetzt brauche ich euch bei {ort}!"', '"notruf_erinnert_abgelehnt": "Ihr habt mich damals abgewiesen. Jetzt brauche ich Euch bei {ort}!"', 'Text: Ihrzen (Euch gross)'],
  [BW, '"bitte_transport": "Bringt diese Ware nach {ziel}. Es eilt, und ich zahle mit meinem Dank."', '"bitte_transport": "Bringt diese Ware nach {ziel}. Es eilt, und ich zahle mit meinem Dank, versprochen, ganz sicher, in bar und sofort."', 'Text: Bitte laenger als 100 Zeichen'],
  [NA, '"Glücksgroschen"', '"Gluecksgroschen"', 'Schiffsname ohne Umlaut'],
  [BW, '"wert": "Einklappen",', '"wert": "Später",', 'Beschriftung wieder „Später“'],
  [VF, '"text": "Wir bringen eure Ware."', '"text": "Wir bringen eure Ware, und zwar sofort und ohne Umweg."', 'Option laenger als 44 Zeichen'],
  [WE, '"text_max": 44}', '"text_max": 80}', 'Optionstexte wieder 80 Zeichen'],
  // ---- F6: Fracht-Ziel und Funk
  [FR, "  if (!andockbar(game, fr.nach)) return { ok: false, grund: 'Zielhafen nicht andockbar' };   // nie eine Scheinfracht: die Crew koennte dort nicht abliefern", '', 'Fracht: laden nimmt auch nicht andockbare Ziele (Scheinfracht)'],
  [FR, '  for (let d = 1; d <= W.fracht_reichweite.wert; d++) {', '  for (let d = 1; d <= 1; d++) {', 'Fracht-Ziel: Reichweite nur ein Schritt'],
  [FR, 'a[1] - b[1] || (a[0] < b[0] ? -1 : 1)', 'a[1] - b[1] || (a[0] < b[0] ? 1 : -1)', 'Fracht-Ziel: bei Gleichstand der groessere Code'],
  [FR, 'a[1] - b[1] || (a[0] < b[0] ? -1 : 1)', '(a[0] < b[0] ? -1 : 1)', 'Fracht-Ziel: nicht der naechste, sondern der kleinste Code in Reichweite'],
  [FR, '  if (!W.fracht_ziel_fraktionen.wert.includes(Besitz.besitzer(game, hex))) return false;', '', 'Fracht-Ziel: auch germanische und Piratenhaefen'],
  [FR, "  funk(game, 'laden', frachtVars(fr));", '', 'Fracht: kein Funk beim Laden'],
  [FR, "    funk(game, 'abgeliefert', frachtVars(f.fracht));", '', 'Fracht: kein Funk beim Abliefern'],
  [FR, "  if (f && f.fracht) funk(game, 'verloren', frachtVars(f.fracht));", '', 'Fracht: kein Funk bei Verlust'],
  [FD, "  if (f.fracht && ausgang === 'gescheitert') { try { require('./faden-fracht.js').verlustMelden(game, f); } catch (e) { fehlerZaehlen(game, 'faden-fracht-funk', e); } }", '', 'Fracht: der Verlust beim Scheitern des Beats wird nicht gemeldet'],
  [SZ, "    if (!r.ok) { Fracht.funk(game, 'kein_ziel', { ort: ort ? Sektoren.hexName(ort) : 'hier' }); return { ausgang: 'gescheitert' }; }", "    if (!r.ok) return { ausgang: 'gescheitert' };", 'Fracht: ohne Ziel kein Funk'],
  [BI, '    if (z) { try { ziel = RE().hexName(z) || z; } catch (e) { ziel = z; } }', '    if (false) { try { ziel = RE().hexName(z) || z; } catch (e) { ziel = z; } }', 'Bitte: der Zielhafen kommt nie in den Text'],
  [BI, "    else { t = roh(beat.parameter && beat.parameter.text_key_kein_ziel); if (typeof t !== 'string') return null; }", "    else { t = roh('bitte_mission'); }", 'Bitte ohne Ziel verspricht trotzdem einen Transport'],
  [SW, '"fracht_reichweite": {"wert": 3,', '"fracht_reichweite": {"wert": 1,', 'Daten: Reichweite 1 statt 3'],
  [SW, '"fracht_ziel_fraktionen": {"wert": ["rom", "saum"]', '"fracht_ziel_fraktionen": {"wert": ["rom", "saum", "ger"]', 'Daten: germanische Haefen als Ziel'],
  [SW, '"laden": "Ware an Bord: {ware} für {hafen}. Bei der Ankunft im Hafen andocken."', '"laden": "Fracht geladen."', 'Daten: Ladetext ohne Ware und Hafen'],
  // ---- F7: Ablehnen laedt keine Ware
  [PR, "ags.has('gelungen') && ags.has('gescheitert') && zielIndex(v, i, aus.gelungen, idx) === zielIndex(v, i, aus.gescheitert, idx)", "ags.has('gelungen') && ags.has('gescheitert') && zielIndex(v, i, aus.gelungen, idx) === -5", 'Pruefer: Annehmen und Ablehnen duerfen in denselben Beat fuehren'],
  [P3, "    const mitFracht = (nsc.gedaechtnis || []).some((g) => g.ereignis === 'fracht_gelungen' || g.ereignis === 'fracht_gescheitert');", '    const mitFracht = true;', 'Enthuellung: der Text spricht von Fracht, die es nie gab'],
  [VF, '"gescheitert": { "status": "aktiv", "weiter": "b_enthuell" }\n      }\n    },\n    {\n      "id": "b_fracht"', '"gescheitert": { "status": "aktiv", "weiter": "b_fracht" }\n      }\n    },\n    {\n      "id": "b_fracht"', 'Daten: Ablehnen fuehrt wieder in die Fracht (Scheinwahl)'],
  // ---- Client: Bittentext, Kopf, Frist, Plakette, Kappe
  [FW, "    if (von && t.toLowerCase().indexOf((von + ':').toLowerCase()) === 0) t = t.slice(von.length + 1).trim();", '', 'Client: „<von>: “ am Anfang des Bittentextes bleibt stehen'],
  [FW, "    return /\\{\\w*\\}/.test(t) ? '' : t;", '    return t;', 'Client: Text mit offenem Platzhalter wird gezeigt'],
  [FW, '    if (l.length > 2) l = [l[0], R && R.measure ?', '    if (false) l = [l[0], R && R.measure ?', 'Client: Bittentext nicht auf zwei Zeilen gekuerzt'],
  [FW, "  const textH = (m, R) => { const n = textZeilen(m, R).length; return n ? n * 10 + 3 : 0; };", '  const textH = (m, R) => 0;', 'Client: Hoehe der Leiste ohne Bittentext'],
  [FW, "    for (const l of textZeilen(m, R)) { R.text(ctx, l, r.x + 6, ty, { color: SK.text, shadow: false }); ty += 10; }   // F1: der Bittentext", '', 'Client: der Bittentext wird nie gezeichnet'],
  [FW, "const kopfText = (m) => (m.art === 'bitte' ? m.kopf : 'FUNK') + ' · ' + m.von + (m.art === 'bitte' && m.fk ? ' · ' + m.fk : '');", "const kopfText = (m) => (m.art === 'bitte' ? m.kopf : 'FUNK') + ' · ' + m.von;", 'Client: Kopf ohne Kuerzel der Fraktion'],
  [FW, "(m.art === 'bitte' ? (m.rest <= 1 ? 'läuft ab' : voll ? '' : 'offen')", "(m.art === 'bitte' ? (m.rest <= 0 ? 'läuft ab' : voll ? '' : 'offen')", 'Client: „läuft ab“ erst bei rest 0'],
  [FW, "voll ? '' : 'offen'", "voll ? 'offen' : 'offen'", 'Client: „offen“ auch in der vollen Leiste'],
  [FW, '    if (bild) root.Hud.drawFunkBild(ctx, m.pid, r.x + BILD_X, r.y + 3, 22);', '    if (bild) root.Hud.drawFunkBild(ctx, m.pid, r.x + 4, r.y + 2, 22);', 'Client: Plakette nicht bündig'],
  [FW, "    if (rest) R.text(ctx, rest, r.x + r.w - 6, gl, { color: SK.dim, align: 'right' });", "    if (rest) R.text(ctx, rest, r.x + r.w - 6, r.y + 4, { color: SK.dim, align: 'right' });", 'Client: Frist nicht auf der Grundlinie des Kopfes'],
  [FW, "    if (punkt) { ctx.fillStyle = SK.text; ctx.fillRect(", "    if (false) { ctx.fillStyle = SK.text; ctx.fillRect(", 'Client: Punkt-Kappe nicht fett'],
  [FW, '  const kopfH = (m) => (m && m.art === \'bitte\' && m.pid ? 26 : KOPF);', '  const kopfH = (m) => KOPF;', 'Client: Kopf mit Porträt nicht höher'],
  // ---- Client: Ruf-Slot und Vorrang, ODA
  [FW, '    return dbg ? { x: 404, y: 0, w: 232, h: sz ? 9 : STREIFEN } : { x: VW - BREITE - RAND, y: 0, w: BREITE, h: sz ? 9 : STREIFEN };', '    return dbg ? { x: 404, y: 0, w: 232, h: sz ? 9 : STREIFEN } : { x: VW - BREITE - RAND, y: 6, w: BREITE, h: sz ? 9 : STREIFEN };', 'Ruf-Slot: y 6 statt 0 (ueber den Koepfen)'],
  [FW, '    return dbg ? { x: 404, y: 0, w: 232, h: sz ? 9 : STREIFEN }', '    return dbg ? { x: 300, y: 0, w: 232, h: sz ? 9 : STREIFEN }', 'Ruf-Slot: Debug-Modus nicht neben der FPS-Zeile'],
  [FW, '{ x: 404, y: 0, w: 232, h: sz ? 9 : STREIFEN }', '{ x: 404, y: 0, w: 232, h: STREIFEN }', 'Ruf-Slot: mit Szenenzeile nicht 9 hoch'],
  [FW, "    try { return !!(streifen && k && H && typeof H.lagefunkEinzeilig === 'function' && H.lagefunkEinzeilig(view)); } catch (e) { return false; }", '    return false;', 'Ruf-Slot: der Lagefunk hat keinen Vorrang'],
  [FW, '    if (streifen) { const sl = slot(view); return { x: sl.x, y: sl.y, w: sl.w, h: sl.h }; }', '    if (streifen && bedienflaechen(k)) { const sl = slot(view); return { x: sl.x, y: sl.y, w: sl.w, h: sl.h }; }', 'Ruf-Slot: Steuer und Ops behalten den Streifen unten'],
  [FW, '      ctx.fillStyle = SK.messing; ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); ctx.fillRect(r.x, r.y, 3, r.h);', "      ctx.fillStyle = '#E0473C'; ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1); ctx.fillRect(r.x, r.y, 3, r.h);", 'Streifen: Akzent in Gefahr-Rot statt Messing'],
  [FW, '    if (!m || !k || !zu(k)) return 0;', '    if (!m || !k) return 0;', 'Ops: die volle Leiste nimmt der Karte die Zoom-Beschriftung'],
  [FW, '    if (!k) { const o = odaH(view); return { x: Math.round((VW - BREITE) / 2), y: VH - h - UNTEN - (o > 0 ? o + 4 : 0), w: BREITE, h }; }', '    if (!k) { const o = odaH(view); return { x: Math.round((VW - BREITE) / 2), y: VH - h - UNTEN, w: BREITE, h }; }', 'ODA: die Leiste steht auf der ODA-Zeile'],
  [HU, "      if (c === 'shop') return true;", '      if (false) return true;', 'Hud: am Terminal keine einzeilige Lagefunk-Zeile'],
  [HU, "      return (c === 'weapons' || c === 'helm') && pult;", "      return c === 'weapons' && pult;", 'Hud: an der Steuerung keine einzeilige Lagefunk-Zeile'],
  [HU, '      return 10 + R.wrap(cur.text, 284 - 44, 1).length * 10;', '      return 0;', 'Hud: die ODA-Zeile hat keine Hoehe'],
  [HU, "      return window.Funkwahl && typeof Funkwahl.streifenUnten === 'function' ? Funkwahl.streifenUnten(view) : 0;", '      return 0;', 'Hud: Ops kennt den Streifen nicht (Zoom-Beschriftung bleibt)'],
  // ---- Client: Portrait, Funk der Faeden
  [HU, '      ctx.fillStyle = MESSING; ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, w - 1, w, 1); ctx.fillRect(0, 0, 1, w); ctx.fillRect(w - 1, 0, 1, w);', '', 'Portraet ohne Messingrahmen'],
  [HU, "      else if (v === 2) { r(6, 4, 12, 4, '#46556A'); r(4, 8, 16, 1, '#46556A'); }", "      else if (v === 2) { r(6, 4, 12, 4, '#2A3A52'); r(4, 8, 16, 1, '#2A3A52'); }", 'Portraet: Muetze wieder dunkel'],
  [HU, "      return f && (f.fd === 1 || f.ton === 'meldung') ? (window.KarteTokens", "      return f && f.ton === 'meldung' ? (window.KarteTokens", 'Hud: Funk der Faeden bleibt rot'],
  [HU, "      if (f.fd) return 'FUNK · ' + (von ? von + ' · ' : '') + text;", '', 'Hud: Zeile des Fadenfunks beginnt mit LAGE'],
  [HU, 'fd: fd === 1 || fd === 2 ? fd : 0, ton:', 'fd: fd, ton:', 'Hud: onRadio nimmt jede Kennung als fd'],
  [CL, ', !!(ev.sz && !ev.r), ev.fd, ev.ton);', ', !!(ev.sz && !ev.r), undefined, ev.ton);', 'Client: fd geht nicht an Hud.onRadio'],
  [KL, 't: Number.isFinite(ev.tick) ? ev.tick : null, fd: ev.fd === 1 || ev.fd === 2 ? ev.fd : 0, ton:', 't: Number.isFinite(ev.tick) ? ev.tick : null, ton:', 'Funk-Reiter: KarteLage merkt fd nicht'],
  [CO, "e.fd === 1 || e.ton === 'meldung' ? KarteTokens.FARBE.funk.akzentLage : KarteTokens.FARBE.funk.akzentFeind", "e.ton === 'meldung' ? KarteTokens.FARBE.funk.akzentLage : KarteTokens.FARBE.funk.akzentFeind", 'Funk-Reiter: Fadenfunk in Rot'],
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
console.log(`Mutationsprobe Nacharbeit Welle 2 (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
