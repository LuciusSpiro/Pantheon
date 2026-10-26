'use strict';
// SUND-04a-1 A: Mutationsprobe zu tools/test-zielsysteme.js, tools/test-verfolgung.js und tools/test-verfolgung-bot.js (gezielter Antriebstreffer, Verfolgung). Kopiert Server, Shared, Content, Client-Module und
// die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test
// die Regel ab. Vorher prüft ein Selbstcheck, dass jeder Anker genau einmal vorkommt (sonst Exit 2, keine stille Auslassung).
//   node tools/mutation-antrieb.js [begriff …]      (npm run test:antrieb-mutation)
//   node tools/mutation-antrieb.js --trocken         nur die Anker prüfen
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-antrieb-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(TMP, 'public', 'index.html'));
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
// die Tests (die Bot-Läufe laden sim-headless.js und dessen Hilfsmodule)
const TESTS = [['tools/test-zielsysteme.js'], ['tools/test-verfolgung.js'], ['tools/test-verfolgung-bot.js']];
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) if (f.endsWith('.js') && (/^(test-zielsysteme|test-verfolgung)/.test(f) || f === 'sim-headless.js' || f === 'regie-fixture.js')) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const ZS = 'server/sim/zielsysteme.js', VF = 'server/sim/verfolgung.js', SP = 'server/sim/space.js', PI = 'server/sim/pilot.js', KO = 'server/sim/konvoi.js', FL = 'shared/flight.js', SW = 'server/sim/schiffswaffen.js',
  DZ = 'content/kampf/zielsysteme-werte.json', DV = 'content/kampf/verfolgung-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalente Mutanten): „wendeTempoMin 0“ (die Wende-Untergrenze 8 px/s rundet auf die Stopp-Stufe, die Klemme tempoMin 0,25 liegt darüber: nur bei Tempo unter 0,041, außerhalb der Klemme, unterscheiden sich die Varianten; vom Entwicklungsleiter als äquivalent dokumentiert, 2026-10-26), „Wiederholung auch bei wiederholung false“ (update() prüft k.wiederholung ein zweites Mal vor neu()), „das Schiff fährt während der Ladung weiter“ (nur der Bremsweg: es bremst vor oder am Fluchtpunkt), „Geschosse tragen opts.angriff auch ohne Szenenschalter“ (space.js: der Haken fragt den Schalter nur, damit die Optionen in Szenen ohne Schalter unverändert bleiben; trifftLerche prüft ihn selbst, das Verhalten ist gleich).
const MUTATIONEN = [
  // ---- Trefferregel Lerche -> Gegner (zielsysteme.js)
  [ZS, "if (!e || sx == null || !(opts && opts.angriff)) return false;", "if (!e || sx == null) return false;", 'Gegner: auch Treffer ohne opts.angriff (Brocken, Minen, Zonen) zählen'],
  [ZS, "    if (!szene && !gezielt) continue;", "", 'Gegner: ungezielte Treffer zählen auch ohne Szenenschalter'],
  [ZS, "    if (seiteGetroffen(game, e, sx, sy) !== seiteIndex(sys)) continue;\n    if (!wuerfeln(game, gezielt ?", "    if (!wuerfeln(game, gezielt ?", 'Gegner: jede Seite trifft den Antrieb, nicht nur das Heck'],
  [ZS, "    if (!wuerfeln(game, gezielt ? TREFFER.wahrscheinlichkeit.gezielt : TREFFER.wahrscheinlichkeit.ungezielt)) continue;\n    if (schaedige(game, e, id)) getroffen = true;", "    if (!wuerfeln(game, TREFFER.wahrscheinlichkeit.gezielt)) continue;\n    if (schaedige(game, e, id)) getroffen = true;", 'Gegner: ungezielt trifft so sicher wie gezielt'],
  [ZS, "    if (!wuerfeln(game, gezielt ? TREFFER.wahrscheinlichkeit.gezielt : TREFFER.wahrscheinlichkeit.ungezielt)) continue;\n    if (schaedige(game, e, id)) getroffen = true;", "    if (!wuerfeln(game, TREFFER.wahrscheinlichkeit.ungezielt)) continue;\n    if (schaedige(game, e, id)) getroffen = true;", 'Gegner: gezielt trifft nur mit der ungezielten Wahrscheinlichkeit'],
  [ZS, "const gewaehlt = !opts.ally && game.ship.target === e.id ?", "const gewaehlt = !opts.ally ?", 'Gegner: das Systemziel gilt für jedes Ziel, nicht nur das gewählte'],
  [ZS, "const gewaehlt = !opts.ally && game.ship.target === e.id ?", "const gewaehlt = game.ship.target === e.id ?", 'Gegner: Verbündete treffen gezielt'],
  [ZS, "function wuerfeln(game, p) { return p >= 1 ? true : p > 0 && game.rng.chance(p); }", "function wuerfeln(game, p) { return p > 0; }", 'Würfel: ungezielt trifft immer'],
  // ---- Stufen, Sperre, Erholung
  [ZS, "  if (cur.gehalten || game.time < cur.sp) return false;", "  if (cur.gehalten) return false;", 'Stufen: keine Sperre (eine Salve schaltet den Antrieb in einem Zug aus)'],
  [ZS, "  if (cur.gehalten || game.time < cur.sp) return false;", "  if (game.time < cur.sp) return false;", 'Stufen: ein gestelltes Schiff (gehalten) kann sich verschlechtern/erholen'],
  [ZS, "  cur.s++;\n  cur.sp = game.time + TREFFER.sperre_s;", "  cur.s = letzte;\n  cur.sp = game.time + TREFFER.sperre_s;", 'Stufen: der erste Treffer schaltet gleich ganz aus'],
  [ZS, "    if (TREFFER.letzteStufeVerlaengert) {", "    if (true) {", 'Stufen: Dauerfeuer auf der letzten Stufe verlängert die Erholungsfrist (A-S2)'],
  [DZ, '"letzteStufeVerlaengert": false', '"letzteStufeVerlaengert": true', 'Daten: letzte Stufe verlängert die Frist'],
  [VF, "  if (!KLASSEN.includes(klasse)) return null;", "", 'Faden-Schnittstelle: unbekannte Zielklasse (Jäger) wird nicht abgelehnt'],
  [VF, "  if (aktiv(game) && !ausgang(game)) return null;", "", 'Faden-Schnittstelle: eine laufende Verfolgung wird überschrieben'],
  [VF, "wiederholung: q.wiederholung === true,", "wiederholung: q.wiederholung !== false,", 'Faden-Schnittstelle: Wiederholung Standard an (A-K2)'],
  [VF, "  if (game.ship.target === e.id) { game.ship.target = null; delete game.ship.zielsystem; }", "  if (game.ship.target === e.id) { game.ship.target = null; }", 'Zielsystem: bleibt nach dem Abgang des Ziels stehen (A-K3)'],
  [DV, '"haltAbstand": 30', '"haltAbstand": 0', 'Daten: Halt am Ziel ohne Abstand (A-K4)'],
  [DV, '"randAbstand": 60', '"randAbstand": 0', 'Daten: Start am Szenenrand (A-K4)'],
  [ZS, "  cur.bis = d.erholung_s != null ? game.time + d.erholung_s : null;\n  game.emit('sfx'", "  cur.bis = null;\n  game.emit('sfx'", 'Erholung: der Antrieb erholt sich nie'],
  [ZS, "      if (cur.bis == null || game.time < cur.bis) continue;", "      if (cur.bis == null) continue;", 'Erholung: sofort'],
  [ZS, "      cur.s--;\n      if (cur.s <= 0) { delete e.zs[id]; continue; }", "      cur.s = 0;\n      if (cur.s <= 0) { delete e.zs[id]; continue; }", 'Erholung: ausgefallen erholt sich in einem Schritt auf voll'],
  [ZS, "    if (!Object.keys(e.zs).length) delete e.zs;", "", 'Erholung: ein erholtes Schiff behält e.zs (alter Pfad nicht wiederhergestellt)'],
  [ZS, "function halte(e, id) { if (e && e.zs && e.zs[id]) { e.zs[id].gehalten = true; e.zs[id].bis = null; } }", "function halte(e, id) { }", 'Stellen: ein gestelltes Schiff erholt sich'],
  [ZS, "    if (d && d.faktor != null) f *= d.faktor;", "    if (d && d.faktor != null) f *= 1;", 'Tempo: der Faktor wirkt nicht'],
  [ZS, "function ausgefallen(e, id) { return stufe(e, id) >= maxStufe(id) && stufe(e, id) > 0; }", "function ausgefallen(e, id) { return stufe(e, id) > 0; }", 'Ausfall: schon beschädigt gilt als ausgefallen'],
  // ---- Systemziel und Snapshot
  [ZS, "  if (!e.scanned) return 'Erst das Ziel scannen (S halten).';", "", 'Befehl: Systemziel auch am ungescannten Ziel'],
  [ZS, "  if (!sys.klassen.includes(e.kind)) return `Dieses Ziel hat keinen ${sys.name} zum Anvisieren.`;", "", 'Befehl: Systemziel an Klassen ohne das System'],
  [ZS, "  if (!e || !e.zs || !e.scanned) return null;\n  let o = null;", "  if (!e || !e.zs) return null;\n  let o = null;", 'Snapshot: der Schaden ist auch am ungescannten Ziel sichtbar'],
  // ---- Gegenseite (Lerche)
  [ZS, "if (!(opts && opts.angriff) || !szeneAktiv(game) || !r || !(Number(r.hull) > 0)) return false;", "if (!(opts && opts.angriff) || !szeneAktiv(game) || !r) return false;", 'Lerche: ein vom Schild gefangener Treffer schädigt den Antrieb'],
  [ZS, "if (!(opts && opts.angriff) || !szeneAktiv(game) || !r || !(Number(r.hull) > 0)) return false;", "if (!(opts && opts.angriff) || !r || !(Number(r.hull) > 0)) return false;", 'Lerche: auch ohne Szenenschalter'],
  [ZS, "if (!(opts && opts.angriff) || !szeneAktiv(game) || !r || !(Number(r.hull) > 0)) return false;", "if (!szeneAktiv(game) || !r || !(Number(r.hull) > 0)) return false;", 'Lerche: auch Treffer ohne opts.angriff (Mine, Brocken)'],
  [ZS, "ship.systems[sys.lerche] == null || sector !== seiteIndex(sys)) continue;", "ship.systems[sys.lerche] == null) continue;", 'Lerche: jeder Sektor schädigt das Triebwerk, nicht nur das Heck'],
  [ZS, "    if (game.time < (sp[id] != null ? sp[id] : -1e9) + TREFFER.sperre_s) continue;", "", 'Lerche: keine Sperre zwischen zwei Stufen'],
  [ZS, "    const gezielt = opts.zielt === id;", "    const gezielt = true;", 'Lerche: Gegner zielen immer'],
  [ZS, "    const gezielt = opts.zielt === id;", "    const gezielt = false;", 'Lerche: Gegner mit Systemziel zielen nicht'],
  // ---- Haken in space.js, pilot.js, konvoi.js, flight.js, schiffswaffen.js
  [SP, "  if (e.hp > 0) { if (opts && opts.angriff) Zielsysteme.trifftGegner(game, e, srcX, srcY, opts); return; }", "  if (e.hp > 0) { return; }", 'Haken: damageEnemy meldet Hüllentreffer nicht'],
  [SP, "  if (opts.angriff && hull > 0) Zielsysteme.trifftLerche(game, sector, r, opts);", "", 'Haken: shipHit meldet Treffer auf die Lerche nicht'],
  [SP, "    if (e.zs) vKin *= Zielsysteme.tempoFaktor(e);", "", 'Haken: kinematisches Modell ignoriert den Antrieb'],
  [SP, "    if (e.fluchtZiel) vKin = Verfolgung.legacyTempo(cfg.speed, e);", "", 'Haken: kinematisches Modell kennt kein Fluchttempo'],
  [PI, "Flight.stepBody(e, input, c, e.zs ? { speedFactor: Zielsysteme.tempoFaktor(e) } : null, dt);", "Flight.stepBody(e, input, c, null, dt);", 'Haken: Pilot-Modell ignoriert den Antrieb'],
  [PI, "(c.minSpeed || 0) * (e.zs ? Math.min(1, Zielsysteme.tempoFaktor(e)) : 1);", "(c.minSpeed || 0);", 'Haken: Jäger behalten ohne Antrieb ihre Mindestfahrt'],
  [KO, "{ speedFactor: e.zs ? Zielsysteme.tempoFaktor(e) : 1 }", "{ speedFactor: 1 }", 'Haken: Konvoi-Transporter ignorieren den Antrieb'],
  [FL, "const vmin = sf > 0 ? (cls.minSpeed || 0) * Math.min(1, sf) : 0;", "const vmin = sf > 0 ? (cls.minSpeed || 0) : 0;", 'Flug: beschädigter Antrieb senkt die Mindestfahrt nicht'],
  [SP, "if (owner && Zielsysteme.szeneAktiv(game)) { hopts.angriff = true; if (owner.zielsystem) hopts.zielt = owner.zielsystem; }", "if (owner && Zielsysteme.szeneAktiv(game)) { hopts.angriff = true; }", 'Gegenseite: Geschosse tragen das Systemziel des Schützen nicht'],
  [SP, "Zielsysteme.szeneAktiv(game) ? { heavy: true, emp, angriff: true, zielt: e.zielsystem } : { heavy: true, emp }", "{ heavy: true, emp }", 'Gegenseite: die Ladung (Lanze) der Gegner ist kein Angriff im Sinn der Regel'],
  [SP, "  Zielsysteme.szeneAn(game, false);   // SUND-04a-1 A: der Szenenschalter gilt nur in der Szene, die ihn setzt", "", 'Szenenwechsel: der Szenenschalter bleibt stehen'],
  [SP, "{ game.ship.tscan.progress = 0; delete game.ship.zielsystem; }", "{ game.ship.tscan.progress = 0; }", 'Ziel: das Systemziel bleibt beim Zielwechsel stehen'],
  [SP, "  delete ship.zielsystem;   // SUND-04a-1 A\n", "", 'Szenenwechsel: das Systemziel bleibt stehen'],
  [SP, "p.kind === 'ally' ? { ally: true, angriff: true } : undefined);", "p.kind === 'ally' ? { ally: true } : undefined);", 'Verbündete: ihre Treffer sind kein Angriff'],
  [SW, "opts ? Object.assign({ angriff: true }, opts) : { angriff: true }", "opts", 'Waffen der Lerche: Lanze und Batterien sind kein Angriff im Sinn der Regel'],
  [SP, "  Zielsysteme.update(game);   // SUND-04a-1 A: Erholung der Zielsysteme (nur Gegner mit e.zs)", "", 'Tick: die Erholung läuft nie'],
  [SP, "  Verfolgung.update(game, dt);   // SUND-04a-1 A: Fluchtpunkt, Sprungladung, Stellen, Ausgang (ohne Verfolgung sofort zurück)", "", 'Tick: die Verfolgung läuft nie'],
  [SP, "  if (e.zs) { const zx = Zielsysteme.snapExtra(e); if (zx) Object.assign(o, zx); }", "", 'Snapshot: kein az'],
  [SP, "  if (e.fluchtZiel) { const vx = Verfolgung.snapExtra(e); if (vx) Object.assign(o, vx); }", "", 'Snapshot: kein sj und nm'],
  // ---- Verfolgung
  [VF, "  Zielsysteme.szeneAn(game, true);", "", 'Verfolgung: Szenenschalter wird nicht gesetzt'],
  [VF, "  if (GEGNER.zielenAufAntrieb) e.zielsystem = SYSTEM_ZIEL;", "", 'Verfolgung: das Zielschiff zielt nicht auf den Antrieb der Lerche'],
  [VF, "  if (k.szene !== game.ship.scene) { delete game.space.verfolgung; return; }", "", 'Verfolgung: lebt über den Szenenwechsel hinaus'],
  [VF, "if (d > bd) { bd = d; best = c; }", "if (d < bd || best === null) { bd = d; best = c; }", 'Fluchtpunkt: der nächste statt der entfernteste'],
  [VF, "x = clamp(L.x + Math.cos(head) * ZIEL.startAbstand, m, sp.w - m)", "x = clamp(L.x - Math.cos(head) * ZIEL.startAbstand, m, sp.w - m)", 'Aufbau: das Zielschiff startet hinter der Lerche'],
  [VF, "  if (e.sprung == null && !aus && dist(e.x, e.y, fp.x, fp.y) <= FLUCHT.ankunftRadius) {", "  if (e.sprung == null && dist(e.x, e.y, fp.x, fp.y) <= FLUCHT.ankunftRadius) {", 'Sprung: auch mit ausgefallenem Antrieb'],
  [VF, "    if (e.hp < k.hpLast - 1e-9) k.verz = Math.min(SPRUNG.verzoegerungMax, k.verz + SPRUNG.verzoegerungJeTreffer);", "", 'Sprung: Hüllentreffer verzögern nicht'],
  [VF, "Math.min(SPRUNG.verzoegerungMax, k.verz + SPRUNG.verzoegerungJeTreffer)", "k.verz + SPRUNG.verzoegerungJeTreffer", 'Sprung: Verzögerung unbegrenzt'],
  [VF, "    if (!(aus && SPRUNG.pausiertBeiAusfall)) e.sprung += dt;", "    e.sprung += dt;", 'Sprung: ein ausgefallener Antrieb hält die Ladung nicht an'],
  [VF, "    const dauer = SPRUNG.dauer + k.verz;", "    const dauer = SPRUNG.dauer;", 'Sprung: die Dauer enthält die Verzögerung nicht'],
  [VF, "  k.stellT = aus && dist(e.x, e.y, L.x, L.y) <= STELLEN.radius ? k.stellT + dt : 0;", "  k.stellT = aus ? k.stellT + dt : 0;", 'Stellen: der Radius zählt nicht'],
  [VF, "  k.stellT = aus && dist(e.x, e.y, L.x, L.y) <= STELLEN.radius ? k.stellT + dt : 0;", "  k.stellT = dist(e.x, e.y, L.x, L.y) <= STELLEN.radius ? k.stellT + dt : 0;", 'Stellen: der Antrieb muss nicht ausgefallen sein'],
  [VF, "  if (k.stellT >= STELLEN.zeit) gestellt(game, k, e);", "  if (k.stellT > 0) gestellt(game, k, e);", 'Stellen: keine Haltezeit'],
  [VF, "  Zielsysteme.halte(e, SYSTEM_ZIEL);   // ein gestelltes Schiff bleibt ausgefallen", "", 'Stellen: der Antrieb erholt sich nach dem Stellen'],
  [VF, "  e.fluchtZiel = null; e.sprung = null; e.sprungDauer = null;\n  Zielsysteme.halte", "  Zielsysteme.halte", 'Stellen: das gestellte Schiff flieht weiter'],
  [VF, "  if (was === 'entkommen' && k.wiederholung) k.neuAt = game.time + WDH.neuNach;", "", 'Ausgang: keine Wiederholung'],
  [VF, "function erfolg(game) { const k = st(game); return !!(k && (k.ausgang === 'gestellt' || k.ausgang === 'zerstoert')); }", "function erfolg(game) { const k = st(game); return !!(k && k.ausgang); }", 'Erfolg: auch entkommen zählt'],
  [VF, "  if (!e) { setzeAusgang(game, k, 'zerstoert'); return; }", "", 'Ausgang: ein zerstörtes Zielschiff beendet nichts'],
  [VF, "  stats(game)[was]++;", "", 'Zähler: Ausgänge werden nicht gezählt'],
  [PI, "  else if (e.fluchtZiel) cmd = flucht(game, e, c);", "", 'Flucht (Pilot): das Zielschiff flieht nicht'],
  [SP, "    if (e.fluchtZiel) {   // SUND-04a-1 A: Verfolgung", "    if (false) {   // SUND-04a-1 A: Verfolgung", 'Flucht (kinematisch): das Zielschiff flieht nicht'],
  // ---- Daten
  [DZ, '"ungezielt": 0.35', '"ungezielt": 1', 'Daten: ungezielt trifft immer'],
  [DZ, '"ungezielt": 0.35', '"ungezielt": 0', 'Daten: ungezielt trifft nie'],
  [DZ, '"seite": "heck"', '"seite": "bug"', 'Daten: Antrieb liegt am Bug'],
  [DZ, '"sperre_s": 1.5', '"sperre_s": 0', 'Daten: keine Sperre'],
  [DZ, '{"id": "beschaedigt", "name": "beschädigt", "faktor": 0.5', '{"id": "beschaedigt", "name": "beschädigt", "faktor": 1', 'Daten: beschädigt bremst nicht'],
  [DZ, '{"id": "ausgefallen", "name": "ausgefallen", "faktor": 0,', '{"id": "ausgefallen", "name": "ausgefallen", "faktor": 0.5,', 'Daten: ausgefallen steht nicht still'],
  [DZ, '"erholung_s": 20}', '"erholung_s": 2}', 'Daten: ausgefallen erholt sich in 2 s'],
  [DV, '"pausiertBeiAusfall": true', '"pausiertBeiAusfall": false', 'Daten: Ausfall hält die Sprungladung nicht an'],
  [DV, '"zielenAufAntrieb": true', '"zielenAufAntrieb": false', 'Daten: das Zielschiff zielt nicht'],
  [DV, '"tempo": 0.65', '"tempo": 1.5', 'Daten: Fluchttempo über der Lerche'],
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
// Erkannt = ein Test ist mit FEHLER-Zeilen rot (eine Prüfung schlägt fehl). Ein Lauf ohne FEHLER-Zeile bei Exit != 0 ist ein ABSTURZ (SyntaxError,
// Laufzeitfehler der Mutante): wird getrennt ausgewiesen und NICHT als erkannt gezählt.
const fehlerZeilen = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-zielsysteme.js, test-verfolgung.js, test-verfolgung-bot.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = fehlerZeilen(r);
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot   ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezählt`); }
  else { ueberlebt++; console.log(`  GRÜN  ${was}  <-- ÜBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} überlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
