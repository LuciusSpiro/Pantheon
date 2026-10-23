'use strict';
// SUND-02b D: Mutationsprobe zu tools/test-absichten.js (und test-absichten-ui.js, test-absichten-ws.js). Kopiert Server, Shared, Content, Client und die Tests in ein Temp-Verzeichnis
// (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0): zuerst der Regeltest, dann der UI-Test, dann der Netztest.
// Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-absichten.js [begriff …]      (npm run test:absichten-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TESTS = ['tools/test-absichten.js', 'tools/test-absichten-ui.js', 'tools/test-absichten-ws.js'];
for (const t of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const A = 'server/sim/absicht.js', K = 'server/sim/kriegslage.js', G = 'server/game.js', U = 'public/js/terminal-ui.js', D = 'content/welt/absichten.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalente Mutanten): „angebotIds füllt unter min nicht auf“ (mit den Daten gibt es immer mindestens min Absichten ohne Bedingung, der Zweig ist Schutz gegen falsche
// Daten, den Daten-Test prüft die Voraussetzung), „zustandVon legt einen leeren Zustand an“ (jede Partie und jeder Ladevorgang legt ihn selbst an), „Roms eigener Angriff zählt als Belagerung“ (Rom greift nie einen eigenen
// Ort an, die Schutzbedingung ist entfernt) und die doppelten Wächter der UI („Enter und X im Bereich Lage prüfen Rang und laufende Absicht, annehmen() und ablehnen() prüfen ein zweites Mal auf ein Angebot:
// ohne Angebot geht nie ein Befehl hinaus, der Test prüft das Ergebnis mit einem Spion auf send).
const MUTATIONEN = [
  // ---- Angebot und Rang
  [A, "n >= s.frei_ab && rangOk(game)) {\n    s.angebot", "n >= s.frei_ab) {\n    s.angebot", 'Angebot auch vor Tribun'],
  [A, "(n >= s.angebot.bis || !rangOk(game))", "(n >= s.angebot.bis)", 'Angebot bleibt bei Rangverlust'],
  [A, "bis: n + W.angebot_dauer.wert };", "bis: n + 1000 };", 'Angebot verfällt nie'],
  [A, "s.laufend = null; s.frei_ab = n + W.abstand_nach_ablauf.wert;", "s.laufend = null; s.frei_ab = 0;", 'keine Pause nach dem Ablauf'],
  [A, "    if (n >= s.angebot.bis) s.frei_ab = n + W.abstand_nach_verfall.wert;\n", "", 'keine Pause nach einem verfallenen Angebot'],
  [A, "if (s.laufend && n >= s.laufend.bis) {", "if (s.laufend && n >= s.laufend.bis + 1000) {", 'Absicht läuft nie ab'],
  [A, "    wirkungRaeumen(z);\n    if (a) funk.push", "    if (a) funk.push", 'Ablauf räumt zustand.absichten.rom nicht'],
  [A, "    if (a) funk.push(fmt(texte().funk.ausgelaufen, { name: a.name }));", "", 'kein Funk beim Auslaufen'],
  [A, "    funk.push(texte().funk.angebot);\n  }\n  return { funk };", "  }\n  return { funk };", 'kein Funk beim Angebot'],
  [A, ".slice(0, n.max);\n  if (liste.length < n.min)", ".slice(0, n.max + 2);\n  if (liste.length < n.min)", 'Angebot hat mehr als max Optionen'],
  [A, "case 'belagert': return f.belagert >= (b.min || 1);", "case 'belagert': return true;", 'Belagerung: Bedingung immer wahr'],
  [A, "case 'staerker': return f.rom >= b.faktor * f.ger;", "case 'staerker': return f.rom <= b.faktor * f.ger;", 'Stärke: Vergleich umgedreht'],
  [A, "case 'knapp': return f.knapp < b.schwelle;", "case 'knapp': return f.knapp > b.schwelle;", 'Knapp: Vergleich umgedreht'],
  [A, "trifft.concat(immer).slice", "immer.concat(trifft).slice", 'Absichten ohne Bedingung stehen vor denen mit Bedingung'],
  [A, "r.t_ende === null && r.t_an !== null && z.hexe", "r.t_ende === null && z.hexe", 'Marsch ohne Ankunft zählt als Belagerung'],
  [A, " && z.hexe[r.ziel].besitzer === 'rom').length", ").length", 'Belagerung eines nicht-römischen Orts zählt'],
  [A, "const vor = (a, b) => (a.prio - b.prio) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);", "const vor = (a, b) => (b.prio - a.prio) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);", 'prio-Reihenfolge umgedreht'],
  // ---- Wahl
  [A, "if (s.laufend) { const a = eintrag(s.laufend.id); return fehl('schon_gewaehlt'", "if (false) { const a = eintrag(s.laufend.id); return fehl('schon_gewaehlt'", 'zweite Wahl wird angenommen (nicht doppelt wählbar fehlt)'],
  [A, "  if (!rangOk(game)) return fehl('rang'", "  if (false) return fehl('rang'", 'Wahl prüft den Rang nicht'],
  [A, "  if (!s.angebot.ids.includes(a.id)) return fehl('nicht_im_angebot');\n", "", 'Wahl einer nicht angebotenen Absicht geht durch'],
  [A, "  wirkungSetzen(ws.zustand, a);\n  return null;", "  return null;", 'Wahl setzt zustand.absichten.rom nicht'],
  [A, "bis: ws.tickZahl + a.dauer };", "bis: ws.tickZahl + 1 };", 'Wahl: Dauer ignoriert die Daten'],
  [A, "  s.angebot = null;\n  wirkungSetzen", "  wirkungSetzen", 'Wahl lässt das Angebot stehen'],
  [A, "for (const k of FELDER) if (Number.isFinite(a.wirkung[k])) w[k] = a.wirkung[k];", "w.p_act = a.wirkung.p_act;", 'Wirkung setzt nur p_act'],
  [A, "  if (!z.absichten || typeof z.absichten !== 'object') z.absichten = {};\n  const w = {};", "  z.absichten = {};\n  const w = {};", 'Wahl überschreibt fremde Einträge in zustand.absichten'],
  [A, "delete z.absichten[FRAKTION]; }", "z.absichten = {}; }", 'Aufräumen löscht fremde Einträge in zustand.absichten'],
  // ---- Ablehnen, Ignorieren, Ruf
  [A, "s.angebot = null; s.frei_ab = ws.tickZahl + W.abstand_nach_verfall.wert;   // Ablehnen", "s.angebot = null;   // Ablehnen", 'Ablehnen ohne Pause'],
  [A, "s.angebot = null; s.frei_ab = ws.tickZahl + W.abstand_nach_verfall.wert;   // Ablehnen ändert den Ruf nie", "s.angebot = null; s.frei_ab = ws.tickZahl + W.abstand_nach_verfall.wert; ws.ruf.rom = Math.max(0, ws.ruf.rom - 2);   // Ablehnen", 'Ablehnen kostet Ruf'],
  [A, "    if (n >= s.angebot.bis) s.frei_ab = n + W.abstand_nach_verfall.wert;\n", "    if (n >= s.angebot.bis) { s.frei_ab = n + W.abstand_nach_verfall.wert; game.weltsim.ruf.rom = Math.max(0, game.weltsim.ruf.rom - 1); }\n", 'Ignorieren (Verfall) kostet Ruf'],
  [A, "  s.angebot = null;\n  wirkungSetzen(ws.zustand, a);", "  s.angebot = null; ws.ruf.rom += 3;\n  wirkungSetzen(ws.zustand, a);", 'Annehmen gibt Ruf'],
  ['content/welt/ruf-werte.json', '"posten_gesprengt_pirat":', '"absicht_gewaehlt": {"fraktion": "rom", "delta": 1}, "posten_gesprengt_pirat":', 'Daten: Ruf-Quelle für Absichten'],
  // ---- Atomar, Speichern, Laden
  [K, "    ws.absicht = absichtSicher;\n", "", 'kein Rollback der Absicht'],
  [K, "    absichtFunk = Absicht.nachTick(game, ws.tickZahl + 1).funk;", "    absichtFunk = [];", 'Takt der Absichten fehlt im Tick'],
  [K, "Absicht.melde(game, absichtFunk);", "/* stumm */", 'Funk der Absichten fehlt'],
  [K, "const ab = Absicht.toSave(ws); if (ab) b.absicht = ab;", "", 'Speichern vergisst die Absicht'],
  [K, "game.weltsim.absicht = Absicht.lesen(b.absicht, game.weltsim.tickZahl);", "game.weltsim.absicht = Absicht.neu();", 'Laden vergisst die Absicht'],
  [K, "  Absicht.nachLaden(game);", "", 'Laden setzt die Wirkung nicht wieder'],
  [A, "if (s.laufend) b.laufend = { id: s.laufend.id, start: s.laufend.start, bis: s.laufend.bis };", "", 'toSave lässt laufend weg'],
  [A, "if (s.angebot) b.angebot = { ids: s.angebot.ids.slice(), t: s.angebot.t, bis: s.angebot.bis };", "", 'toSave lässt das Angebot weg'],
  [A, "  if (s.frei_ab > 0) b.frei_ab = s.frei_ab;", "", 'toSave lässt die Pause weg'],
  [A, "if (a && bis != null && bis > t) out.laufend", "if (a && bis != null && bis > t - 100000) out.laufend", 'Leser nimmt abgelaufene Absicht'],
  [A, "bis: Math.min(bis, t + a.dauer) };", "bis };", 'Leser klemmt die Dauer nicht'],
  [A, "if (ids.length >= W.anzahl.wert.min && bis != null && bis > t)", "if (ids.length >= 0 && bis != null && bis > t)", 'Leser nimmt ein Angebot mit weniger als min Optionen'],
  [A, "const istUnsere = (w) => !!w && KATALOG", "const istUnsere = (w) => !!w || KATALOG", 'Laden räumt auch fremde Einträge'],
  [A, "  else if (z.absichten && istUnsere(z.absichten[FRAKTION])) wirkungRaeumen(z);", "", 'festgeklemmte Wirkung bleibt nach dem Laden'],
  // ---- Anzeige und Protokoll (Server)
  [A, "b.rest = Math.max(0, s.angebot.bis - ws.tickZahl);", "b.rest = s.angebot.bis;", 'Anzeige: Restzeit des Angebots falsch'],
  [A, "s.angebot ? s.angebot.ids.join(',') + ':' + (s.angebot.bis - ws.tickZahl) : '-'", "s.angebot ? s.angebot.ids.join(',') : '-'", 'Änderungsschlüssel ohne Restzeit'],
  [G, "else if (!ak && this.sentAbsichtKey) { world.absicht = null; this.sentAbsichtKey = null; }", "else if (!ak && this.sentAbsichtKey) { this.sentAbsichtKey = null; }", 'kein Löschsignal'],
  [G, "if (ak && ak !== this.sentAbsichtKey && !includeAsteroids && !includeWorld && !includeLog && !includeBook)", "if (ak && ak !== this.sentAbsichtKey)", 'Block auch in den großen Snapshots'],
  [G, "if (ak && ak !== this.sentAbsichtKey && !includeAsteroids", "if (ak && !includeAsteroids", 'Block in jedem Snapshot (nicht nur bei Änderung)'],
  [G, "shop: 'shop', werft: 'shop', absicht: 'shop',", "shop: 'shop', werft: 'shop', absicht: 'helm',", 'Befehl absicht.* an der falschen Konsole'],
  [G, "        if (!r && op === 'waehlen') { try { Absicht.meldeGewaehlt(this); }", "        if (false) { try { Absicht.meldeGewaehlt(this); }", 'kein Funk bei der Wahl'],
  [G, "if (p.conn) this.sendTo(p.conn, Object.assign({ t: 'event', kind: 'absichtAntwort', pid: p.id, op, ok: !r }", "if (false) this.sendTo(p.conn, Object.assign({ t: 'event', kind: 'absichtAntwort', pid: p.id, op, ok: !r }", 'keine Antwort an den Absender'],
  ['shared/protocol.js', "CMD_ABSICHT: ['absicht.waehlen', 'absicht.ablehnen'],", "CMD_ABSICHT: ['absicht.waehlen', 'absicht.ablehnen', 'absicht.setzen'],", 'Protokoll: zusätzlicher Absicht-Befehl'],
  ['server/sim/werft.js', "const b = msg.b === 'h' ? 'h' : msg.b === 'l' ? 'l' : 'w';", "const b = msg.b === 'h' ? 'h' : 'w';", 'Zuschauer-Ansicht kennt den Bereich Lage nicht'],
  // ---- Client
  [U, "    if (s.zusehen || !AB || !AB.angebot.length || !id) return;\n    cmd(view, 'absicht.waehlen'", "    if (!AB || !AB.angebot.length || !id) return;\n    cmd(view, 'absicht.waehlen'", 'UI: Zuschauer sendet die Wahl'],
  [U, "    if (s.zusehen || !AB || !AB.angebot.length) return;\n    cmd(view, 'absicht.ablehnen'", "    if (!AB || !AB.angebot.length) return;\n    cmd(view, 'absicht.ablehnen'", 'UI: Zuschauer sendet Ablehnen'],
  [U, "    } else if (ev.kind === 'absichtAntwort') {", "    } else if (ev.kind === 'absichtAntwortX') {", 'UI: Antwort des Servers wird nicht verarbeitet'],
  [U, "a.bereich === 'lage' ? ((lageKarte(absicht(), a.lage) || {}).id || null)", "a.bereich === 'lage' ? null", 'UI: Ansicht an den Server ohne gewählte Karte'],
  ['public/js/absicht.js', "if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'absicht')) store.absicht = msg.world.absicht && typeof msg.world.absicht === 'object' ? msg.world.absicht : null;", "if (msg.world && msg.world.absicht) store.absicht = msg.world.absicht;", 'Client: Löschsignal wird ignoriert'],
  ['public/js/absicht.js', "if (msg.phase === 'lobby') { store.absicht = null; return; }", "", 'Client: Lobby leert den Block nicht'],
  ['public/js/absicht.js', ".slice(0, 3) : [];", ".slice(0, 30) : [];", 'Client: mehr als 3 Karten'],
  // ---- Daten
  [D, '"mindestrang": {"wert":"tribun"', '"mindestrang": {"wert":"miles"', 'Daten: Mindestrang Miles'],
  [D, '"anzahl": {"wert":{"min":2,"max":3}', '"anzahl": {"wert":{"min":2,"max":5}', 'Daten: bis zu 5 Optionen'],
  [D, '"wirkung":{"p_act":0.4,"aggr":0.7,"max_active":5}', '"wirkung":{"p_act":0.25,"aggr":0.5,"max_active":3}', 'Daten: Offensive ist die Standard-KI'],
  [D, '"wirkung":{"p_act":0.4,"aggr":0.7,"max_active":5}', '"wirkung":{"p_act":0.4,"aggr":0.05,"max_active":5}', 'Daten: Offensive greift nicht an'],
  [D, '"wirkung":{"p_act":0.15,"aggr":1,"max_active":3}', '"wirkung":{"p_act":0.4,"aggr":0.7,"max_active":5}', 'Daten: Verteidigung greift an wie die Offensive'],
  [D, '"id":"bereitschaft","name":"Wachsam bleiben","prio":5,"text":"Rom behält seine Posten im Blick und greift seltener an als sonst.","dauer":12,"wirkung":{"p_act":0.2,"aggr":0.25,"max_active":3},"bedingung":{"art":"immer"}', '"id":"bereitschaft","name":"Wachsam bleiben","prio":5,"text":"Rom behält seine Posten im Blick und greift seltener an als sonst.","dauer":12,"wirkung":{"p_act":0.2,"aggr":0.25,"max_active":3},"bedingung":{"art":"knapp","schwelle":3}', 'Daten: nur eine Absicht ohne Bedingung'],
  [D, '"id":"ausgreifen","name":"Neue Posten setzen","prio":4,"text":"Die Legion besetzt freie Sektoren und sichert so den Nachschub, ohne einen Krieg anzufangen.","dauer":12', '"id":"ausgreifen","name":"Neue Posten setzen","prio":4,"text":"Die Legion besetzt freie Sektoren und sichert so den Nachschub, ohne einen Krieg anzufangen.","dauer":0', 'Daten: Dauer 0'],
  [D, '"abstand_nach_verfall": {"wert":12', '"abstand_nach_verfall": {"wert":2', 'Daten: Pause nach Verfall kürzer als nach Ablauf'],
  ['content/flotte/absichten.json', '"schon_gewaehlt": "Schon gewählt:', '"schon_gewaehlt": "Gewählt:', 'Text: „Schon gewählt“ fehlt'],
  ['content/flotte/absichten.json', '"funk": {\n    "angebot": "Rom bietet Euch eine Absicht an: Ihr könnt dem Kurs der Legion eine Richtung geben.', '"funk": {\n    "angebot": "Ihr MÜSST jetzt eine Absicht wählen, sonst Abzug: Ihr könnt dem Kurs der Legion eine Richtung geben.', 'Text: Angebot droht mit Abzug'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
const rot = (r) => r.status !== 0;
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-absichten.js, test-absichten-ui.js, test-absichten-ws.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
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
  let wer = null, r = null;
  for (const t of TESTS) { r = lauf(t); if (rot(r)) { wer = path.basename(t, '.js').replace('test-', ''); break; } }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
