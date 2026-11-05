'use strict';
// MON-02 P1: Mutationsprobe zu Rudel, Aktion kreatur_besetzen, erzeugenAuf und Baustein aufgeben (tools/test-kreatur-rudel.js).
// Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle und verlangt, dass der Test mit einer echten Prüfung rot wird
// (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt. Mutationen, die nichts beobachten lässt (äquivalent), stehen mit einer Begründung und müssen überleben.
//   node tools/mutation-kreatur-rudel.js [begriff …] [--trocken]      (npm run test:kreatur-rudel-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-rudel-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const T = 'tools/test-kreatur-rudel.js';
for (const rel of [T, 'tools/gel02-hilfen.js', 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const KR = 'server/sim/kreatur.js', PL = 'server/mission/bausteine/kreaturen.js', JS = 'content/kampf/kreaturen.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Tests, gleichwertig (Begründung) oder fehlt]
const MUTATIONEN = [
  // ---- Platzwahl (rudelSetzen)
  [KR, 'if (!m.geht(cx, cy) || (dist && dist[cy * m.w + cx] < 0)) continue;', 'if (!m.geht(cx, cy)) continue;', 'Plätze: Erreichbarkeit vom Abholpunkt wird nicht geprüft', [T]],
  [KR, 'if (abhol.some((a) => Math.hypot(tx - a.x, ty - a.y) < RUDEL_ABHOLPUNKT)) continue;', 'if (false) continue;', 'Plätze: kein Mindestabstand zum Abholpunkt', [T]],
  [KR, 'if (rects && !rects.some((r) => tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3])) continue;', 'if (false) continue;', 'Plätze: der Bereich wird nicht beachtet (ganze Karte)', [T]],
  [KR, "if (!b || !Array.isArray(b.rects)) return fehl('Bereich \"' + p.bereich + '\" gibt es auf der Karte ' + p.map + ' nicht (' + Object.keys(k.bereiche || {}).join(', ') + ')');\n    rects = b.rects;",
    "if (!b || !Array.isArray(b.rects)) { /* stiller Rückfall */ }\n    rects = b ? b.rects : null;", 'Bereich: unbekannter Bereich fällt still auf die ganze Karte zurück', [T]],
  [KR, 'const RUDEL_ABSTAND = 1.5;', 'const RUDEL_ABSTAND = 0.5;', 'Abstand der Tiere nur 0,5 Kacheln', [T]],
  [KR, 'if (wahl.some((w) => (w.x - q.x) * (w.x - q.x) + (w.y - q.y) * (w.y - q.y) < D2)) continue;', 'if (false) continue;', 'Abstand: Tiere des Rudels untereinander nicht geprüft', [T]],
  [KR, 'if (vorhanden.some((K) => (K.x - q.x) * (K.x - q.x) + (K.y - q.y) * (K.y - q.y) < D2)) continue;', 'if (false) continue;', 'Abstand: vorhandene Kreaturen der Karte nicht beachtet', [T]],
  [KR, 'Math.floor(aw.rng() * pool.length)', 'Math.floor(Math.random() * pool.length)', 'Zufall: Mittelpunkt aus Math.random statt aw.rng', [T]],
  [KR, 'Math.floor(aw.rng() * pool.length)', 'Math.floor(game.rng() * pool.length)', 'Zufall: Mittelpunkt aus game.rng (verschiebt den Strom des Spiels)', [T]],
  [KR, 'K.facing = aw.rng() * Math.PI * 2;', 'K.facing = game.rng() * Math.PI * 2;', 'Zufall: Blickrichtung aus game.rng', [T]],
  // ---- Prüfungen der Aktion
  [KR, '|| n > RUDEL_MAX) return fehl(', '|| n > 99) return fehl(', 'Anzahl: Obergrenze 12 fehlt', [T]],
  [KR, 'if (!Number.isInteger(n) || n < 1 ||', 'if (!Number.isInteger(n) || n < 0 ||', 'Anzahl: 0 ist erlaubt', [T]],
  [KR, 'if (!Number.isInteger(n) || n < 1', 'if (n < 1', 'Anzahl: keine ganze Zahl verlangt', [T]],
  [KR, 'try { typ = hat(daten().typen, p.typ) ? typVon(p.typ) : null; }', 'try { typ = daten().typen[p.typ] ? typVon(p.typ) : null; }', 'Typ: Prüfung über Eigenschaftszugriff statt eigener Eigenschaft (constructor)', [T]],
  [KR, 'const GRUPPE_FORM = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;', 'const GRUPPE_FORM = /.*/;', 'Gruppe: jede Zeichenkette erlaubt (leer, __proto__)', [T]],
  [KR, "if (alt && alt.typ !== p.typ) return fehl(", 'if (false) return fehl(', 'Gruppe: anderer Typ in derselben Gruppe erlaubt', [T]],
  // ---- Kennung und Buchführung
  [KR, 'if (gruppe != null) K.gruppe = gruppe;', '', 'Kennung K.gruppe wird nicht gesetzt', [T]],
  [KR, 'G[p.gruppe] = { erschienen: (alt ? alt.erschienen : 0) + n, typ: p.typ };', 'G[p.gruppe] = { erschienen: n, typ: p.typ };', 'aw.kreaturGruppen: erschienen addiert nicht', [T]],
  [KR, 'if (aw && aw.kreaturGruppen) delete aw.kreaturGruppen; ', '', 'raeumen räumt aw.kreaturGruppen nicht mit', [T]],
  [KR, 'ids.indexOf(K.typ), Math.round(K.x * 10) / 10', '0, Math.round(K.x * 10) / 10', 'Snapshot: typCode immer 0', [T]],
  // ---- erzeugenAuf
  [KR, 'return anlegen(game, aw, typId, o.x, o.y, o.gruppe != null ? o.gruppe : null);', 'return anlegen(game, game.away, typId, o.x, o.y, o.gruppe != null ? o.gruppe : null);', 'erzeugenAuf legt auf game.away statt auf der gegebenen Karte an', [T]],
  [KR, 'if (aw !== game.away) for (const b of Object.keys(typ.bausteine))', 'if (false) for (const b of Object.keys(typ.bausteine))', 'erzeugenAuf: Typ mit beiErzeugen (bindung) auf fremder Karte ohne Wurf', [T]],
  // ---- Baustein aufgeben
  [KR, 'a.n = K.rammTreffer ? 0 : a.n + 1;', 'a.n = a.n + 1;', 'aufgeben: ein Treffer setzt den Zähler nicht zurück', [T]],
  [KR, 'a.n = K.rammTreffer ? 0 : a.n + 1;', 'a.n = 0;', 'aufgeben: der Zähler zählt nie', [T]],
  [KR, "if (typVon(K.typ).zustaende[von].modus !== 'ramme') return;", 'if (false) return;', 'aufgeben: jeder Zustandswechsel zählt als Anlauf', [T]],
  [KR, 'if (!a || a.n < par.anlaeufe) return false;', 'if (!a || a.n < par.anlaeufe - 1) return false;', 'aufgeben: schon einen Anlauf früher', [T]],
  [KR, 'a.n = 0; return true;', 'return true;', 'aufgeben: der Auslöser verbraucht den Zähler nicht', [T]],
  [KR, 'if (K.aufgeben && K.aufgeben.n > 0 && !jagend(K, ctx.typ)) K.aufgeben.n = 0;', 'if (K.aufgeben && K.aufgeben.n > 0 && false) K.aufgeben.n = 0;', 'aufgeben: Verlust des Ziels setzt den Zähler nicht zurück', [T]],
  [KR, 'def.beiWechsel(game, K, von, nach, typ.bausteine[b])', 'def.beiWechsel(game, K, nach, von, typ.bausteine[b])', 'Hook beiWechsel: von und nach vertauscht', [T]],
  [KR, 'if (K.z != null) bausteinWechsel(game, K, K.z, zn);', '', 'Hook beiWechsel wird nie gerufen', [T]],
  [KR, "'beiAusruesten', 'beiWechsel', 'pruefen'])", "'beiAusruesten', 'pruefen'])", 'Anmeldung: beiWechsel nicht als Hook geprüft', [T]],
  [KR, 'par.anlaeufe > 50)', 'par.anlaeufe > 5000)', 'Validator aufgeben: Obergrenze fehlt', [T]],
  [KR, '!Number.isInteger(par.anlaeufe) || ', '', 'Validator aufgeben: ganze Zahl nicht verlangt', [T]],
  [KR, 'if (!AUFGEBEN_FELDER.includes(k)) F.push(', 'if (false) F.push(', 'Validator aufgeben: unbekannte Felder erlaubt', [T]],
  // ---- Plugin kreatur_besetzen
  [PL, 'bereich: a.bereich != null ? a.bereich : null', 'bereich: null', 'Aktion: Parameter bereich wird nicht weitergereicht', [T]],
  [PL, 'if (r.fehler) g.countError(', 'if (false) g.countError(', 'Aktion: Fehler werden nicht gemeldet', [T]],
  [PL, "typ: a.typ, anzahl: a.anzahl", "typ: 'probe', anzahl: a.anzahl", 'Aktion: Typ wird nicht weitergereicht', [T]],
  [PL, 'anzahl: { typ: \'number\', pflicht: true, min: 1, max: 12 }', 'anzahl: { typ: \'number\', pflicht: true, min: 1, max: 99 }', 'Aktion: Parameter anzahl ohne Obergrenze 12', [T]],
  [PL, "gruppe: { typ: 'string', pflicht: true } },", "gruppe: { typ: 'squad', pflicht: true } },", 'Aktion: gruppe als squad (der Prüfer verlangt einen Regiebuch-Eintrag)', [T]],
  // ---- Daten
  [JS, '"groesse": 1,\n      "kollision": { "box": 20 },', '"groesse": 2,\n      "kollision": { "box": 20 },', 'Daten: rudeltier hat Größe 2', [T]],
  [JS, '{ "auf": "aufgegeben", "nach": "suche" }, ', '', 'Daten: jagd führt nie in suche (kein Aufgeben)', [T]],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 180000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe Rudel (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf(T);
  console.log(`  Ausgangslage ${T}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, tests, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let fe = [], absturz = false, von = null;
  for (const test of tests) {   // der erste Test mit einer roten Prüfzeile genügt
    const r = lauf(test);
    const e = r.status === 0 ? [] : pruefFehler(r);
    if (e.length) { fe = e; von = test; break; }
    if (r.status !== 0) absturz = true;
  }
  fs.writeFileSync(f, orig);
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß; ' + gleichwertig})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${path.basename(von)}: ${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
