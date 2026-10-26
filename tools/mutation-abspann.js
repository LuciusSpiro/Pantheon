'use strict';
// SUND-04a-3: Mutationsprobe zu tools/test-abspann.js. Kopiert Server, Shared, Content, Client und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und
// verlangt, dass der Test rot wird. Ueberlebt eine Mutation, deckt kein Test die Regel ab.
// Anker-Selbstcheck zuerst: jeder alte Text muss GENAU EINMAL vorkommen und der unveraenderte Test muss bestehen (sonst Exit 2).
// Abstuerze zaehlen NICHT als erkannt: erkannt ist eine Mutation nur, wenn der Test sauber mit „n FEHLER“ endet und mindestens eine echte Pruefung (nicht nur eine Ausnahme) rot ist.
//   node tools/mutation-abspann.js [--trocken] [begriff …]      (npm run test:abspann-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TROCKEN = process.argv.includes('--trocken');
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abspann-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public/js'].forEach((r) => { fs.mkdirSync(path.dirname(path.join(TMP, r)), { recursive: true }); kopiere(r); });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-abspann.js'), path.join(TMP, 'tools', 'test-abspann.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const A = 'server/sim/abspann.js', K = 'server/sim/kriegslage.js', H = 'public/js/hud.js', D = 'content/welt/abspann.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- die sechs verlangten
  [A, "if (game.phase === 'end' || markerVon(game)) return false;", "", 'beenden nicht idempotent'],
  [A, "  game.markSaveDue('missionDone');", "", 'markSaveDue weg (ungedockt wird der Marker nicht gespeichert)'],
  [A, "const art = markerVon(game);\n  if (!art || game.phase === 'end') return;", "const art = markerVon(game) || 'palatina';\n  if (game.phase === 'end') return;", 'nachLaden ohne Marker-Pruefung'],
  [A, "    if (!ok) return false;\n  }\n  return true;", "    if (ok) return false;\n  }\n  return true;", 'wenn-Bedingung invertiert'],
  [A, "  if (a.schluss) out.schluss = a.schluss;", "", 'schluss fehlt im Ergebnis von bauen'],
  [A, "if (!game || !game.weltsim || !ARTEN.includes(art)) return false;", "if (!game || !ARTEN.includes(art)) return false;", 'Abspann ohne Weltsim-Pruefung (beenden)'],
  // ---- weitere Regeln des Abspann-Kerns
  [A, "a.schluss ? { schluss: a.schluss } : {}) });", "{}) });", 'endGame bekommt den Schluss nicht'],
  [A, "  if (!game || !game.weltsim) return;\n  const art = markerVon(game);", "  if (!game) return;\n  const art = markerVon(game);", 'nachLaden ohne Weltsim-Pruefung'],
  [A, "if (k === 'rang_min') ok = rangIndex(f.rang) >= rangIndex(v);", "if (k === 'rang_min') ok = rangIndex(f.rang) > rangIndex(v);", 'rang_min schliesst den Rang nicht ein'],
  [A, "else if (k === 'rang_max') ok = rangIndex(f.rang) <= rangIndex(v);", "else if (k === 'rang_max') ok = rangIndex(f.rang) < rangIndex(v);", 'rang_max schliesst den Rang nicht ein'],
  [A, "ok = (v.min === undefined || f[k] >= v.min) && (v.max === undefined || f[k] <= v.max);", "ok = (v.min === undefined || f[k] > v.min) && (v.max === undefined || f[k] <= v.max);", 'min schliesst den Wert nicht ein'],
  [A, "ok = (v.min === undefined || f[k] >= v.min) && (v.max === undefined || f[k] <= v.max);", "ok = (v.min === undefined || f[k] >= v.min) && (v.max === undefined || f[k] < v.max);", 'max schliesst den Wert nicht ein'],
  [A, "else if (k === 'faedenAusgang') ok = Object.keys(v).every(", "else if (k === 'faedenAusgang') ok = Object.keys(v).some(", 'faedenAusgang: einer statt alle'],
  [A, "else if (k === 'nicht') ok = !wennGilt(v, f);", "else if (k === 'nicht') ok = wennGilt(v, f);", 'nicht ohne Negation'],
  [A, "else if (k === 'oder') ok = v.some((x) => wennGilt(x, f));", "else if (k === 'oder') ok = v.every((x) => wennGilt(x, f));", 'oder als und'],
  [A, "    else throw new Error(`abspann: unbekannter Schluessel ${k}`);", "    else ok = true;", 'unbekannter Schluessel bei der Auswertung wird still ignoriert'],
  [A, "    else out.push(`${q}: unbekannter Schluessel`);", "", 'Pruefer meldet unbekannten Schluessel nicht'],
  [A, "if (o !== 'min' && o !== 'max') out.push(`${q}.${o}: unbekannter Operator`); else if", "if (false) out.push(`${q}.${o}: unbekannter Operator`); else if", 'Pruefer meldet unbekannten Operator nicht'],
  [A, "if (rangIndex(v) < 0) out.push(`${q}: unbekannter Rang ${JSON.stringify(v)}`);", "if (false) out.push('x');", 'Pruefer meldet unbekannten Rang nicht'],
  [A, "if (ids && !ids.includes(vl)) out.push(`${q}.${vl}: unbekannte Fadenvorlage`);", "", 'Pruefer meldet unbekannte Fadenvorlage nicht'],
  [A, "if (ids.has(b.id)) out.push(`${p}: doppelte Id ${b.id}`);", "", 'Pruefer meldet doppelte Block-Id nicht'],
  [A, "    if (zeilen.length) bloecke.push({ kopf: b.kopf, zeilen });", "    bloecke.push({ kopf: b.kopf, zeilen });", 'Bloecke ohne Zeile bleiben stehen'],
  [A, "const gilt = (x) => x.wenn === undefined || wennGilt(x.wenn, f);", "const gilt = (x) => true;", 'bauen ignoriert alle Bedingungen'],
  [A, "const gilt = (x) => x.wenn === undefined || wennGilt(x.wenn, f);\n  const bloecke = [];\n  for (const b of a.bloecke) {\n    if (!gilt(b)) continue;\n    const zeilen = b.zeilen.filter((z) => typeof z === 'string' || gilt(z))", "const gilt = (x) => x.wenn === undefined || wennGilt(x.wenn, f);\n  const bloecke = [];\n  for (const b of a.bloecke) {\n    if (!gilt(b)) continue;\n    const zeilen = b.zeilen.filter((z) => true)", 'Zeilen mit Bedingung erscheinen immer'],
  [A, "h.code !== haupt && ", "", 'Hafenverluste zaehlen die Hauptwelt mit'],
  [A, "z.hexe[h.code].besitzer !== 'rom') n++;", "z.hexe[h.code].besitzer === 'ger') n++;", 'Hafenverluste zaehlen nur Verluste an die Germanen'],
  [A, "e.kurz.startsWith('Posten gefallen')", "e.kurz.startsWith('Posten')", 'postenVerloren zaehlt auch Gruendungen'],
  [A, "k && k.schicksal === 'gefallen')", "k && k.schicksal === 'entkommen')", 'kommandantenGefallen zaehlt die Falschen'],
  [A, "if (!has(out, f.vorlage) || rang[a] > rang[out[f.vorlage]]) out[f.vorlage] = a;", "out[f.vorlage] = a;", 'Faeden: der letzte Faden gewinnt statt des besten Ausgangs'],
  [A, "const a = f.ausgang && AUSGAENGE.includes(f.ausgang.art) ? f.ausgang.art : 'laufend';", "const a = f.ausgang && AUSGAENGE.includes(f.ausgang.art) ? f.ausgang.art : 'gescheitert';", 'Faden ohne Ausgang gilt als gescheitert'],
  [A, "f.finaleGespielt = !!fk && fk.finale_gespielt === true;", "f.finaleGespielt = false;", 'finaleGespielt wird nie gelesen'],
  [A, "game.weltstand.fact(FAKT, art, quelle || 'kriegslage');", "", 'Marker wird nicht gesetzt'],
  [A, "if (game.weltstand && typeof game.weltstand.fact === 'function') game.weltstand.fact(FAKT, art, quelle || 'kriegslage');", "if (game.weltstand && typeof game.weltstand.fact === 'function') game.weltstand.fact(FAKT, art, quelle || 'kriegslage');\n  if (game.weltstand) game.weltstand.fact('szenario_ende_x', 1, 'x');", 'beenden schreibt zusaetzliche Fakten'],
  [A, "  zeigen(game, bauen(fakten(game), art));\n  return null;", "  beenden(game, art, 'debug');\n  return null;", 'Debug setzt den Marker (die Welt waere danach beendet)'],
  [A, "if (!game.weltsim) return 'Nur in der Freien Fahrt Sund.';", "", 'Debug ohne Freie-Fahrt-Pruefung'],
  [A, "const SZENARIO = 'Freie Fahrt Sund';", "const SZENARIO = 'Palatina ist gefallen';", 'Untertitel doppelt den Titel'],
  // ---- Haken im Spiel
  [K, "  Abspann.beenden(game, wer === 'rom' ? 'palatina' : 'sieg', 'kriegslage');", "", 'Fall der Hauptwelt beendet das Szenario nicht'],
  [K, "wer === 'rom' ? 'palatina' : 'sieg'", "wer === 'rom' ? 'sieg' : 'palatina'", 'Palatina und Sieg vertauscht'],
  [K, "  try { Abspann.nachLaden(game); }", "  try { /* nachLaden aus */ }", 'Laden zeigt den Abspann nicht'],
  // ---- Client
  [H, "          else if (i.k === 'schluss') R.text(ctx, i.t, cx, y, { color: PAL.mint, align: 'center' });\n", "", 'Client zeichnet den Schluss nicht'],
  [H, "      if (ab.schluss) {", "      if (false) {", 'Client uebernimmt den Schluss nicht'],
  [H, "{ color: PAL.mint, align: 'center' });\n        }\n        y += i.h;", "{ color: PAL.alarmrot, align: 'center' });\n        }\n        y += i.h;", 'Schluss in Rot'],
  [H, "items.push({ k: 'luft', t: '', h: 14 });\n        for (const l of R.wrap(String(ab.schluss), colW, 1).slice(0, 3))", "for (const l of R.wrap(String(ab.schluss), 900, 1).slice(0, 3))", 'Schluss ohne Zeilenumbruch'],
  // ---- Daten
  [D, '"schluss": "Hätte sie nur jemand retten können."', '"schluss": "Hätte sie jemand retten können."', 'Daten: Schluss veraendert'],
  [D, '"wenn": { "rang_min": "tribun" },\n          "zeilen": [\n            "Man hörte auf euch', '"wenn": { "rang_min": "legat" },\n          "zeilen": [\n            "Man hörte auf euch', 'Daten: Rangschwelle des hohen Rollenblocks verschoben'],
  [D, '"wenn": { "haefenVerloren": { "min": 1 } },\n          "zeilen": [\n            "Schon vor Palatina', '"wenn": { "haefenVerloren": { "min": 2 } },\n          "zeilen": [\n            "Schon vor Palatina', 'Daten: Verlustgrenze verschoben'],
  [D, '"wenn": { "finaleGespielt": false },', '"wenn": { "finaleGespielt": true },', 'Daten: kampflos mit falscher Bedingung'],
];

function lauf(dir) {
  const r = spawnSync(process.execPath, ['tools/test-abspann.js'], { cwd: dir, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  const aus = (r.stdout || '') + (r.stderr || '');
  const fehler = aus.split('\n').filter((l) => /^ {2}FEHLER /.test(l));
  const echt = fehler.filter((l) => !/FEHLER Ausnahme/.test(l));
  const fertig = /\d+ von \d+ Pruefungen bestanden/.test(aus);
  return { status: r.status, fehler: fehler.length, echt: echt.length, fertig, aus };
}

// Anker-Selbstcheck: jeder alte Text genau einmal, der unveraenderte Test besteht
const text = {};
let ankerFehler = 0;
for (const [datei, alt, , titel] of MUTATIONEN) {
  if (!(datei in text)) text[datei] = fs.readFileSync(path.join(TMP, datei), 'utf8').split('\r\n').join('\n');
  const k = text[datei].split(alt).length - 1;
  if (k !== 1) { ankerFehler++; console.log(`ANKER FEHLER (${k}x statt 1x): ${titel} in ${datei}`); }
}
if (ankerFehler) { console.log(`${ankerFehler} Anker stimmen nicht: die Probe waere wertlos`); process.exit(2); }
const basis = lauf(TMP);
if (basis.status !== 0 || basis.fehler) { console.log('ANKER FEHLER: der unveraenderte Test besteht nicht\n' + basis.aus.split('\n').slice(-15).join('\n')); process.exit(2); }
console.log(`Anker ok: ${MUTATIONEN.length} Anker genau einmal, der unveraenderte Test besteht`);
if (TROCKEN) { console.log('--trocken: keine Mutationen'); process.exit(0); }

let erkannt = 0; const verfehlt = [], abstuerze = [];
const alleDateien = {};
for (const [datei, alt, neu, titel] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => titel.toLowerCase().includes(f))) continue;
  const p = path.join(TMP, datei);
  const orig = fs.readFileSync(p, 'utf8');
  if (!(datei in alleDateien)) alleDateien[datei] = orig;
  const crlf = orig.includes('\r\n');
  const quelle = orig.split('\r\n').join('\n');
  fs.writeFileSync(p, (crlf ? quelle.replace(alt, () => neu).replace(/\n/g, '\r\n') : quelle.replace(alt, () => neu)));
  let r;
  try { r = lauf(TMP); } finally { fs.writeFileSync(p, orig); }
  let ok;
  if (!r.fertig) { abstuerze.push(titel); ok = false; console.log(`  ABSTURZ  ${titel}`); }
  else if (r.status !== 0 && r.echt > 0) { erkannt++; ok = true; console.log(`  erkannt  ${titel} (${r.echt} Pruefungen rot)`); }
  else { verfehlt.push(titel); ok = false; console.log(`  VERFEHLT ${titel}${r.fehler ? ' (nur Ausnahmen: ' + r.fehler + ')' : ''}`); }
}
const gesamt = MUTATIONEN.filter(([, , , t]) => !FILTER.length || FILTER.some((f) => t.toLowerCase().includes(f))).length;
console.log(`\n${erkannt} von ${gesamt} Mutationen erkannt`);
if (abstuerze.length) console.log('Abstuerze (zaehlen nicht als erkannt): ' + abstuerze.join(' | '));
if (verfehlt.length) console.log('Verfehlt: ' + verfehlt.join(' | '));
process.exit(erkannt === gesamt ? 0 : 1);
