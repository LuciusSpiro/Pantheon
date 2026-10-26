'use strict';
// SUND-03b A: Mutationsprobe zu tools/test-funk-antwort.js und tools/test-funk-antwort-ws.js. Kopiert Server, Shared, Content, Client-Module und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf
// EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht
// (Exit 2, wenn nicht: eine Mutation, die nicht ankert, würde sonst still als „erkannt“ gelten). --trocken prüft nur die Anker.
//   node tools/mutation-funk-antwort.js [--trocken] [begriff …]      (npm run test:funk-antwort-mutation)
// Bewusst nicht abgedeckt: die Verdrahtung in public/js/client.js (Taste, Zeichnen, Maus) und das Zeichnen selbst (public/js/funkwahl.js zeichne): dafür gilt die Sichtprüfung tools/sicht-funkwahl.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-funk-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-funk-antwort.js'], ['tools/test-funk-antwort-ws.js']];
for (const f of [...TESTS.map((t) => t[0]), 'tools/regie-fixture.js', 'tools/sim-ruf.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const FA = 'server/sim/funk-antwort.js', RE = 'server/sim/reise-ereignis.js', GA = 'server/game.js', PR = 'shared/protocol.js', FW = 'public/js/funkwahl.js', TA = 'public/js/tasten.js',
  DK = 'content/reise/ereignisse.json', DW = 'content/reise/werte.json', DR = 'content/welt/ruf-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Angebot: nie bei Gefahr, Schalter, ruhige Lage, Mindestzahl
  [FA, "  if (!e || e.gefahr || !optionen(e).length) return null;   // bei Gefahr nie Optionen", "  if (!e || !optionen(e).length) return null;", 'Angebot: auch bei Gefahr'],
  [FA, "  if (!RE.aktiv(game) || !ruhig(game)) return null;", "  if (!ruhig(game)) return null;", 'Angebot: ohne Schalter'],
  [FA, "  if (!RE.aktiv(game) || !ruhig(game)) return null;", "  if (!RE.aktiv(game)) return null;", 'Angebot: auch in unruhiger Lage'],
  [FA, "  if (game.simSzene) return false;\n", "", 'Ruhe: Sim-Szene zählt nicht'],
  [FA, "  if (R && R.laufend && R.laufend.length) return false;\n", "", 'Ruhe: laufende Gefahr zählt nicht'],
  [FA, "  return !((game.space && game.space.enemies) || []).length;", "  return true;", 'Ruhe: Gegner im Sektor zählen nicht'],
  [FA, "  if (erlaubt.length < 2) return null;", "  if (erlaubt.length < 1) return null;", 'Angebot: auch mit nur einer Option (keine Wahl)'],
  [FA, "return romGewinn(gruende) <= romRaum(F, game.weltsim.reise.n) + 1e-9 && romBetrag(gruende) <= RE.rufRaum(game) + 1e-9;", "return romBetrag(gruende) <= RE.rufRaum(game) + 1e-9;", 'Rom-Deckel: Optionen mit Rom-Gewinn bleiben im Angebot'],
  [FA, "return romGewinn(gruende) <= romRaum(F, game.weltsim.reise.n) + 1e-9 && romBetrag(gruende) <= RE.rufRaum(game) + 1e-9;", "return romGewinn(gruende) <= romRaum(F, game.weltsim.reise.n) + 1e-9;", 'Reise-Ruf-Deckel: Optionen ohne Raum bleiben im Angebot (Scheinwahl)'],
  [FA, "  if (gebucht && gewinn > 0) F.romLog.push([ws.reise.n, gewinn]);", "", 'Rom-Deckel: der gebuchte Gewinn wird nicht gezählt'],
  [FA, "  F.romLog = F.romLog.filter((x) => n - x[0] < RUF_FENSTER);\n", "", 'Rom-Deckel: läuft nie ab'],
  [FA, "const OPT_MAX = 3;", "const OPT_MAX = 5;", 'Angebot: mehr als drei Optionen möglich'],
  // ---- Fenster
  [FA, "  if (F && F.offen && game.weltsim.reise.n > F.offen.bis) F.offen = null;   // verfallen ohne Folge", "  if (F && F.offen && game.weltsim.reise.n >= F.offen.bis) F.offen = null;", 'Verfall: einen Sprung zu früh'],
  [FA, "  if (F && F.offen && game.weltsim.reise.n > F.offen.bis) F.offen = null;   // verfallen ohne Folge", "  if (F && F.offen && game.weltsim.reise.n > F.offen.bis + 50) F.offen = null;", 'Verfall: nie'],
  [FA, "  if (F.offen && !ruhig(game)) F.offen = null;   // die Lage ist nicht mehr ruhig: das Angebot verfällt\n", "", 'Update: unruhige Lage zieht das Angebot nicht zurück'],
  [FA, "  if (F.reaktion && game.time >= F.reaktion.ab) {", "  if (F.reaktion) {", 'Reaktion: ohne Verzögerung'],
  [FA, "F.reaktion = { ab: game.time + W.antwort_reaktion_s,", "F.reaktion = { ab: game.time,", 'Reaktion: Verzögerung 0'],
  // ---- Befehl
  [FA, "  if (lfd != null && lfd !== off.lfd) return fehl('kein_angebot');", "", 'Befehl: die Nummer des Angebots zählt nicht'],
  [FA, "  if (!ruhig(game)) { F.offen = null; return fehl('unruhig'); }\n", "", 'Befehl: Antwort auch in unruhiger Lage'],
  [FA, "  F.offen = null;\n  if (id === IGNORIEREN) {", "  if (id === IGNORIEREN) {", 'Befehl: das Angebot bleibt nach der Antwort offen (die erste gilt nicht)'],
  [FA, "  if (!off) return fehl(F.zuletzt && F.zuletzt.n === ws.reise.n ? 'schon_beantwortet' : 'kein_angebot');", "  if (!off) return fehl('kein_angebot');", 'Befehl: „schon beantwortet“ fehlt'],
  [FA, "  if (!RE.aktiv(game)) return fehl('kein_angebot');\n  const F = zustandVon(game);\n  const off", "  const F = zustandVon(game);\n  const off", 'Befehl: wirkt auch ohne Schalter'],
  [FA, "const kat = id === IGNORIEREN || !off.optionen.some((o) => o.id === id) ? null : optionVon(e, id);", "const kat = id === IGNORIEREN ? null : optionVon(e, id);", 'Befehl: auch eine ausgeblendete Option ist wählbar'],
  [FA, "  const gebucht = RE.gruendeBuchen(game, Array.isArray(kat.folge) ? kat.folge : [], 'rom');", "  const gebucht = 0;", 'Folge: wird nie gebucht'],
  [FA, "Array.isArray(kat.folge) ? kat.folge : [], 'rom');", "Array.isArray(kat.folge) ? kat.folge : []);", 'Reise-Ruf-Deckel: Konkordat-Antworten zählen mit (verdrängen Rom-Folgen)'],
  [FA, "  if (id === IGNORIEREN) { F.zuletzt = { lfd: off.lfd, n: ws.reise.n, id, gebucht: 0 }; return null; }", "  if (id === IGNORIEREN) { F.zuletzt = { lfd: off.lfd, n: ws.reise.n, id, gebucht: RE.gruendeBuchen(game, ['funk_rom_gruss'], 'rom') }; return null; }", 'Ignorieren: kostet etwas (Folge)'],
  [FA, "  Chronik.eintragen(game, { art: 'reise', ref: off.id, kurz: `Funkantwort an", "  void ({ art: 'reise', ref: off.id, kurz: `Funkantwort an", 'Chronik: die Antwort steht nicht darin'],
  [FA, "  funkSenden(game, antwort.von, antwort.text);   // alle sehen die Antwort der Crew\n", "", 'Funk: die Antwort der Crew fehlt'],
  [FA, "  const reaktion = textFuer(off.ev, 'reaktion', id, game);\n", "  const reaktion = { von: 'Lerche', text: 'Verstanden.' };\n", 'Funk: die Reaktion des Sprechers ist nicht die des Katalogs'],
  // ---- Text
  [FA, "    if (game && Ausschnitt.ohneNamen(s, Ausschnitt.spielerNamen(game)) !== s) return null;   // nie ein Spielername im Text\n", "", 'Text: ein Pooltext mit Spielername wird übernommen'],
  [FA, "    if (!s || s.length > max) return null;", "    if (!s) return null;", 'Text: ein zu langer Pooltext wird übernommen'],
  [FA, "  } catch (e) { return null; }\n}\nfunction textFuer", "  } catch (e) { throw e; }\n}\nfunction textFuer", 'Text: ein werfender Pool bricht das Angebot'],
  // ---- Anzeige
  [FA, "  if (!F || !F.offen || !RE.aktiv(game)) return null;", "  if (!F || !F.offen) return null;", 'Snapshot: auch ohne Schalter'],
  [FA, "optionen: F.offen.optionen.map((o) => ({ id: o.id, text: o.text })),", "optionen: F.offen.optionen.map((o) => ({ id: o.id, text: o.text, folge: 1 })),", 'Snapshot: Folgen im Netz'],
  [FA, "  return s ? s.nr + ':' + s.rest : null;", "  return s ? String(s.nr) : null;", 'Schlüssel: der Verfall (rest) löst keinen neuen Block aus'],
  // ---- Einhängen in die Reise-Ereignisse
  [RE, "  FA().anbieten(game, ev);   // SUND-03b A: Funk-Antwort (nur wo der Katalog antworten hat)\n", "", 'Anbindung: Funkmeldungen bieten keine Antwort'],
  [RE, "  else { folgeBuchen(game, e); FA().anbieten(game, ev); }", "  else { folgeBuchen(game, e); }", 'Anbindung: die Streife bietet keine Antwort'],
  [RE, "funk(game, textFuer(o.ev, 'dank', game)); FA().anbieten(game, o.ev); }", "funk(game, textFuer(o.ev, 'dank', game)); }", 'Anbindung: Havarie-Notrufe bieten keine Antwort'],
  [RE, "  FA().nachSprung(game);   // SUND-03b A: ein offenes Funk-Angebot verfällt nach antwort_gilt_spruenge Sprüngen\n", "", 'Anbindung: der Sprung lässt kein Angebot verfallen'],
  [RE, "  FA().update(game);   // SUND-03b A: Reaktion des Sprechers, Angebot in unruhiger Lage zurückziehen\n", "", 'Anbindung: update: keine Reaktion des Sprechers'],
  [RE, ".filter((w) => !nurFraktion || w.fraktion === nurFraktion)", ".filter(() => true)", 'Deckel: nurFraktion wirkungslos'],
  [RE, "  if (betrag > 0) {\n    R.rufLog = R.rufLog.filter(", "  if (true) {\n    R.rufLog = R.rufLog.filter(", 'Deckel: auch Folgen ohne Rom-Betrag füllen ihn'],
  // ---- Server: Befehl und Snapshot
  [GA, "const r = p.downed ? FunkAntwort.weigerung('am_boden') : FunkAntwort.beantworten(this, String(msg.id), msg.nr == null ? null : Number(msg.nr));", "const r = p.downed ? FunkAntwort.weigerung('am_boden') : FunkAntwort.beantworten(this, String(msg.id), null);", 'Server: die Nummer des Angebots wird nicht weitergegeben'],
  [GA, "const r = p.downed ? FunkAntwort.weigerung('am_boden') : FunkAntwort.beantworten(this, String(msg.id), msg.nr == null ? null : Number(msg.nr));", "const r = FunkAntwort.beantworten(this, String(msg.id), msg.nr == null ? null : Number(msg.nr));", 'Server: auch ein ausgeschalteter Spieler antwortet (kein Schweigen und keine Weigerung)'],
  [GA, "const r = p.downed ? FunkAntwort.weigerung('am_boden') : FunkAntwort.beantworten(this, String(msg.id), msg.nr == null ? null : Number(msg.nr));", "if (p.downed) return;\n      const r = FunkAntwort.beantworten(this, String(msg.id), msg.nr == null ? null : Number(msg.nr));", 'Server: ein Spieler am Boden bekommt Schweigen statt einer Weigerung mit Code'],
  [FA, "  if (!folgeBuchbar(game, F, kat.folge)) return fehl('deckel');", "", 'Befehl: der Deckel wird beim Antworten nicht erneut geprüft (Scheinwirkung)'],
  [FA, "return fehl('deckel');", "{ F.offen = off; return fehl('deckel'); }", 'Befehl: die Ablehnung wegen Deckel lässt das Angebot offen'],
  [FA, "const antwort = { von: W.antwort_von, text: gezeigt.text };", "const antwort = { von: W.antwort_von, text: kat.text };", 'Befehl: gesendet wird nicht der Text des Angebots'],
  [FA, "  if (slot === 'antwort') return { von: W.antwort_von, text: o.text };", "  if (slot === 'antwort') return { von: W.antwort_von, text: ausPool(game, e.art, e.id, slot, o.id, W.antwort_text_max) || o.text };", 'Text: die Beschriftung einer Option kommt aus dem Pool'],
  [FA, "const REAKTION_MAX = Pruefer.WERTE.slots.reaktion.max;", "const REAKTION_MAX = 200;", 'Text: Reaktionslänge nicht aus den Daten (Pooltexte bis zur Prüfer-Grenze werden verworfen)'],
  [GA, "      else if (!fk && this.sentFunkKey) { world.funkwahl = null; this.sentFunkKey = null; }", "      else if (false) { world.funkwahl = null; this.sentFunkKey = null; }", 'Server: kein Löschsignal'],
  [GA, "      if (fk && fk !== this.sentFunkKey && !includeAsteroids", "      if (fk && !includeAsteroids", 'Server: der Block geht in jedem Snapshot mit'],
  [PR, "    CMD_FUNK_ANTWORT: 'funk.antworten',", "    CMD_FUNK_ANTWORT: 'funk.antwort',", 'Protokoll: anderer Befehlsname'],
  // ---- Daten
  [DK, '{ "id": "melden", "text": "Lage an den Hafen melden.", "reaktion": "Die Meldung geht an Rom, Lerche.", "folge": ["funk_rom_meldung"] }', '{ "id": "melden", "text": "Lage an den Hafen melden.", "reaktion": "Die Meldung geht an Rom, Lerche.", "folge": ["funk_kon_nachricht"] }', 'Daten: zwei Optionen mit gleicher Folge (Scheinwahl)'],
  [DK, '      "chronik": "Piraten bei {ort} angekündigt: Wegzoll",', '      "antworten": [{ "id": "a", "text": "Wir zahlen.", "reaktion": "Gut.", "folge": ["funk_rom_gruss"] }, { "id": "b", "text": "Nein.", "reaktion": "Dann Kampf.", "folge": [] }],\n      "chronik": "Piraten bei {ort} angekündigt: Wegzoll",', 'Daten: Antworten bei Gefahr'],
  [DK, '{ "id": "kontore", "text": "Erzählt es den Kontoren.", "reaktion": "Wird gemacht, danke.", "folge": ["funk_kon_nachricht"] }', '{ "id": "kontore", "text": "Erzählt es den Kontoren.", "reaktion": "Wird gemacht, danke.", "folge": ["funk_gibt_es_nicht"] }', 'Daten: unbekannter Grund'],
  [DK, '"text": "Meldet es der Hafenwacht Roms."', '"text": "Meldet es bitte der Hafenwacht Roms, danke sehr."', 'Daten: Antworttext länger als 40 Zeichen'],
  [DK, '{ "id": "verstanden", "text": "Verstanden.", "reaktion": "Gute Fahrt.", "folge": [] }', '{ "id": "ignorieren", "text": "Verstanden.", "reaktion": "Gute Fahrt.", "folge": [] }', 'Daten: Option mit der reservierten Id ignorieren'],
  [DW, '"antwort_rom_max_je_100": {"wert": 0.5,', '"antwort_rom_max_je_100": {"wert": 5,', 'Daten: Rom-Deckel der Antworten viel zu hoch (verkürzt die Rangleiter)'],
  [DW, '"antwort_gilt_spruenge": {"wert": 2,', '"antwort_gilt_spruenge": {"wert": 9,', 'Daten: Angebot gilt 9 Sprünge'],
  [DR, '"funk_rom_gruss": {"fraktion": "rom", "delta": 0.25,', '"funk_rom_gruss": {"fraktion": "rom", "delta": 5,', 'Daten: ein Grund mit großem Delta'],
  [DR, '"funk_rom_werbung": {"fraktion": "rom", "delta": 0.25, "folge": {"kon": -0.5},', '"funk_rom_werbung": {"fraktion": "rom", "delta": 0.25, "folge": {"kon": -0.5, "xyz": 1},', 'Daten: Nebenwirkung auf eine unbekannte Fraktion'],
  // ---- Client
  [TA, "    A('allgemein.funkWaehlen', 'allgemein', 'Funkantwort: nächste Option markieren', ['Period']),", "    A('allgemein.funkWaehlen', 'allgemein', 'Funkantwort: nächste Option markieren', ['KeyW']),", 'Tasten: Funk-Taste ist eine schon belegte Taste (W)'],
  [FW, "    store.markiert = (store.markiert + 1) % zeilen(m).length;", "    store.markiert = store.markiert + 1;", 'Client: die Markierung läuft nicht im Kreis'],
  [FW, "    send({ t: 'cmd', c: 'funk.antworten', id, nr: m.nr });", "    send({ t: 'cmd', c: 'funk.antworten', id });", 'Client: die Nummer des Angebots fehlt im Befehl'],
  [FW, "    if (optionen.length < 2 || !isNum(b.nr)) return null;", "    if (optionen.length < 1 || !isNum(b.nr)) return null;", 'Client: eine einzelne Option wird angezeigt'],
  [FW, "    if (neuNr !== store.nr) { store.markiert = -1; store.eingeklappt = false; store.geoeffnetBei = null; }", "    if (neuNr !== store.nr) { store.markiert = -1; store.geoeffnetBei = null; }", 'Client: „Später“ gilt auch für das nächste Angebot'],
  [FW, "    if (zu()) { aufklappen(); return store.markiert; }   // zugeklappt (Streifen): der erste Druck klappt nur auf, markiert wird erst der nächste\n", "", 'Client: die Taste sendet/markiert auch bei zugeklappter Leiste'],
  [FW, "const m = modell(); if (!m || zu() || store.markiert < 0) return false;", "const m = modell(); if (!m || store.markiert < 0) return false;", 'Client: Senden per Taste bei zugeklappter Leiste'],
  [FW, "    if (msg.phase === 'lobby') { zuruecksetzen(null); return; }", "    if (false) { zuruecksetzen(null); return; }", 'Client: die Lobby leert das Angebot nicht'],
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
const rot = (r) => r.status !== 0;
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-funk-antwort.js, test-funk-antwort-ws.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  let wer = null, r = null;
  for (const t of TESTS) { r = lauf(t); if (rot(r)) { wer = path.basename(t[0], '.js').replace('test-', ''); break; } }   // erst der schnelle Test, der Netztest nur, wenn der überlebt
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
