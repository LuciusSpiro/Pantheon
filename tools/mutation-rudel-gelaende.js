'use strict';
// SPL-01 c: Mutationsprobe zu tools/test-rudel-gelaende.js. Kopiert Server, Shared, Content und die nötigen Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt. Mutationen, die kein Test beobachten kann
// (gleichwertig), stehen mit Begründung und müssen überleben.
//   Zwei Arten: Daten-Mutationen ändern die Umsetzung rudeltiere_im_gelaende im geparsten Katalog (stellung_nehmen.json), Text-Mutationen ersetzen genau eine Stelle im Quelltext.
//   node tools/mutation-rudel-gelaende.js [begriff …] [--trocken]      (npm run test:rudel-gelaende-mutation; je Lauf ein Durchlauf des Tests, einige Minuten)
// Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Daten: Umsetzung vorhanden und Änderung ändert etwas; Text: Anker genau einmal), sonst Exit 2. --trocken prüft nur das und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-rudelg-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'lib'), { recursive: true });
const T = 'tools/test-rudel-gelaende.js';
for (const rel of [T, 'tools/lib/rudel-platz.js', 'tools/gel02-hilfen.js', 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const KR = 'server/sim/kreatur.js', DA = 'content/kampf/kreaturen.json', KAT = 'content/katalog/molekuele/stellung_nehmen.json';
const UMS = 'rudeltiere_im_gelaende';
// Daten-Mutation: fn(u) ändert die Umsetzung im Speicher
const D = (was, fn, gleichwertig) => ({ art: 'daten', was, fn, gleichwertig });
// Text-Mutation: [Datei, alt (genau einmal), neu]
const X = (datei, alt, neu, was, gleichwertig) => ({ art: 'text', datei, alt, neu, was, gleichwertig });
const MUTATIONEN = [
  // ---- Katalog: Kartenarten, Anker, Parameter
  D('Katalog: Höhle nicht mehr unter den Kartenarten', (u) => { u.buehne_braucht.kartenarten = ['wildnis']; }),
  D('Katalog: Wildnis nicht mehr unter den Kartenarten', (u) => { u.buehne_braucht.kartenarten = ['hoehle']; }),
  D('Katalog: zusätzlich Kartenart station', (u) => { u.buehne_braucht.kartenarten.push('station'); }),
  D('Katalog: zusätzlicher Anker wache', (u) => { u.buehne_braucht.anker.push('wache'); }),
  D('Katalog: zusätzlicher Anker nest (Wildnis hat keines)', (u) => { u.buehne_braucht.anker.push('nest'); }),
  D('Katalog: tiere.max 5', (u) => { u.params.tiere.max = 5; }),
  D('Katalog: tiere.min 2', (u) => { u.params.tiere.min = 2; }),
  D('Katalog: rudel erlaubt auch 3', (u) => { u.params.rudel.werte.push('3'); u.abgeleitet.rudel['3'] = JSON.parse(JSON.stringify(u.abgeleitet.rudel['2'])); }),
  D('Katalog: rudel ist Pflicht', (u) => { u.params.rudel.pflicht = true; delete u.params.rudel.default; }),
  // ---- Szene: Aktionen und Bedingung
  D('Szene: zweites Rudel mit derselben gruppe wie das erste', (u) => { u.abgeleitet.rudel['2'].besetzen_b.gruppe = u.abgeleitet.rudel['2'].besetzen_a.gruppe; }),
  D('Szene: zweites Rudel wird nie besetzt', (u) => { u.abgeleitet.rudel['2'].besetzen_b = { set: { '{{id}}_besetzt': true } }; }),
  D('Szene: Bedingung prüft bei zwei Rudeln nur das erste', (u) => { u.abgeleitet.rudel['2'].erledigt = u.abgeleitet.rudel['1'].erledigt; }),
  D('Szene: Bedingung prüft bei zwei Rudeln mit any statt all', (u) => { const e = u.abgeleitet.rudel['2'].erledigt; u.abgeleitet.rudel['2'].erledigt = { any: e.all }; }),
  D('Szene: anzahl fest 3 statt Parameter tiere', (u) => { u.abgeleitet.rudel['1'].besetzen_a.anzahl = 3; u.abgeleitet.rudel['2'].besetzen_a.anzahl = 3; u.abgeleitet.rudel['2'].besetzen_b.anzahl = 3; }),
  D('Szene: zweites Rudel mit anderer Tierzahl (fest 4)', (u) => { u.abgeleitet.rudel['2'].besetzen_b.anzahl = 4; }),
  D('Szene: Besetzung ohne Schutz gegen Wiederholung', (u) => { delete u.abgeleitet.rudel['1'].besetzen_a.if; delete u.abgeleitet.rudel['2'].besetzen_a.if; delete u.abgeleitet.rudel['2'].besetzen_b.if; }),
  D('Szene: bereich hoehle auf der Wildnis (Höhlen-Deck)', (u) => { u.abgeleitet.rudel['1'].besetzen_a.bereich = 'hoehle'; }),
  D('Szene: Typ probe statt rudeltier', (u) => { u.abgeleitet.rudel['1'].besetzen_a.typ = 'probe'; }),
  D('Szene: Bedingung zählt über typ statt gruppe (fremde Gruppen zählen mit)', (u) => { for (const r of ['1', '2']) { const e = u.abgeleitet.rudel[r].erledigt; for (const c of (e.all || [e])) { delete c.check.gruppe; c.check.typ = 'rudeltier'; } } }),
  // ---- Rückfall und Testwerte
  D('Rückfall: tiere 9 (außerhalb des Deckels)', (u) => { u.rueckfall.params.tiere = 9; }),
  D('Rückfall: Parameter fehlen und rudel 7', (u) => { u.rueckfall.params = { rudel: '7' }; }),
  D('Test: Testwert rudel 1 statt 2', (u) => { u.test.params.rudel = '1'; }),
  // ---- Platzierung: Abstand zwischen Rudeln (Daten und Server)
  X(DA, '"jeKarte": 2, "abstand": 12 }', '"jeKarte": 2, "abstand": 0 }', 'Daten: rudel.abstand 0 (kein Abstand zwischen Rudeln)'),
  X(DA, '"jeKarte": 2, "abstand": 12 }', '"jeKarte": 2, "abstand": 6 }', 'Daten: rudel.abstand 6 statt 12'),
  X(DA, '"jeKarte": 2, "abstand": 12 }', '"jeKarte": 2 }', 'Daten: rudel.abstand fehlt'),
  X(KR, '    if (andere.some((K) => (K.x - pos.x) * (K.x - pos.x) + (K.y - pos.y) * (K.y - pos.y) < G2)) continue;\n', '', 'Server: Kandidaten nahe anderer Rudel werden nicht verworfen'),
  X(KR, 'const G2 = RG && RG.abstand ? Math.pow(RG.abstand * TILE, 2) : 0;', 'const G2 = RG && RG.abstand ? Math.pow(RG.abstand, 2) : 0;', 'Server: Abstand in Kacheln statt Pixeln gerechnet (zu klein)'),
  X(KR, 'const G2 = RG && RG.abstand ? Math.pow(RG.abstand * TILE, 2) : 0;', 'const G2 = RG && RG.abstand ? Math.pow(RG.abstand * TILE, 2) : 0;\n  void 0;', 'Server: Anweisung ohne Wirkung', 'kein Verhalten geändert (Gegenprobe der Mutationsprobe selbst)'),
  X(KR, "(aw.kreaturen || []).filter((K) => K.alive && K.typ === p.typ && K.gruppe !== p.gruppe) : [];", "(aw.kreaturen || []).filter((K) => K.alive && K.gruppe !== p.gruppe) : [];", 'Server: Abstand gilt auch zu Tieren anderer Typen', 'in den Tests steht nur der Typ rudeltier auf der Karte; die Karten tragen keine anderen Kreaturen'),
  X(KR, "(aw.kreaturen || []).filter((K) => K.alive && K.typ === p.typ && K.gruppe !== p.gruppe) : [];", "(aw.kreaturen || []).filter((K) => K.alive && K.typ === p.typ) : [];", 'Server: Abstand auch zur eigenen Gruppe', 'rudelSetzen legt die Tiere der eigenen Gruppe erst danach an (andere wird vor der Platzsuche gebildet); nur ein zweiter Aufruf mit derselben gruppe sähe einen Unterschied, den kein Test macht'),
  X(KR, "if (R.abstand !== undefined && !zahl(R.abstand, 0)) f(", "if (false) f(", 'Feldprüfung: rudel.abstand ungeprüft'),
  X(KR, "const RUDEL_FELDER = ['tiere', 'jeKarte', 'abstand'];", "const RUDEL_FELDER = ['tiere', 'jeKarte'];", 'Feldprüfung: abstand als Feld unbekannt (Daten würden abgelehnt)', 'die Daten werden beim Laden abgelehnt, der Test stürzt ab statt eine Prüfzeile zu schreiben (Ladeschutz, kein Verhalten); als Absturz erkannt, nicht als Prüfung'),
];

function datenMutieren(m) {
  const f = path.join(TMP, KAT);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const doc = JSON.parse(orig);
  const u = doc.umsetzungen.find((x) => x.id === UMS);
  if (!u) throw new Error('Umsetzung ' + UMS + ' fehlt');
  const vorher = JSON.stringify(u);
  m.fn(u);
  if (JSON.stringify(u) === vorher) throw new Error('Mutation ändert nichts: ' + m.was);
  let text = JSON.stringify(doc, null, 2) + '\n';
  if (nl) text = text.replace(/\n/g, '\r\n');
  return { f, orig, text };
}

{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const m of MUTATIONEN) {
    if (m.art === 'daten') { try { datenMutieren(m); } catch (e) { schlecht.push(`${m.was}: ${e.message}`); } continue; }
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, m.datei), 'utf8')); } catch (e) { schlecht.push(`${m.was}: Datei ${m.datei} nicht lesbar`); continue; }
    const k = text.split(m.alt).length - 1;
    if (k !== 1) schlecht.push(`${m.was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${m.datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Mutationen anwendbar.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe Rudeltiere im Gelände (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf(T);
  console.log(`  Ausgangslage ${T}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const m of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => m.was.toLowerCase().includes(f))) continue;
  gelaufen++;
  let datei, orig, neu;
  if (m.art === 'daten') { const r = datenMutieren(m); datei = r.f; orig = r.orig; neu = r.text; }
  else {
    datei = path.join(TMP, m.datei);
    orig = fs.readFileSync(datei, 'utf8');
    const nl = orig.includes('\r\n');
    const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
    neu = text.replace(m.alt, () => m.neu);
    if (nl) neu = neu.replace(/\n/g, '\r\n');
  }
  fs.writeFileSync(datei, neu);
  const r = lauf(T);
  fs.writeFileSync(datei, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (m.gleichwertig) {
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${m.was} (gleichwertig: ${fe.length ? 'wurde doch erkannt' : 'überlebt erwartungsgemäß; ' + m.gleichwertig})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${m.was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, keine Prüfzeile' : '')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
