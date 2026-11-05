'use strict';
// MON-02 P2: Mutationsprobe zu Ereignis kreaturAusgefallen und Baustein kreaturen_erledigt (tools/test-kreatur-erledigt.js).
// Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle und verlangt, dass der Test mit einer echten Prüfung rot wird
// (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt. Mutationen, die nichts beobachten lässt (äquivalent), stehen mit einer Begründung und müssen überleben.
//   node tools/mutation-kreatur-erledigt.js [begriff …] [--trocken]      (npm run test:kreatur-erledigt-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-erledigt-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const T = 'tools/test-kreatur-erledigt.js';
for (const rel of [T, 'tools/gel02-hilfen.js', 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const KR = 'server/sim/kreatur.js', PL = 'server/mission/bausteine/kreaturen.js', CB = 'server/sim/combat.js', CK = 'server/mission/checker.js';
const EREIG = "gruppe: K.gruppe != null ? K.gruppe : null, x: Math.round(K.x), y: Math.round(K.y) };\n  game.emit('kreaturAusgefallen'";
const FILTER_K = '(o.gruppe != null ? K.gruppe === o.gruppe : K.typ === o.typ) && nichtEndgueltigErledigt(K)) return false;';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Tests, gleichwertig (Begründung) oder fehlt]
const MUTATIONEN = [
  // ---- Ereignis kreaturAusgefallen
  [CB, '  if (e.kreatur) kreatur().ausgefallenMelden(game, e);', '', 'Ereignis nie: combat.faellt ruft ausgefallenMelden nicht', [T]],
  [KR, '|| K.ausgefallenGemeldet || nichtEndgueltigErledigt(K)) return false;', '|| nichtEndgueltigErledigt(K)) return false;', 'Ereignis doppelt: die Prüfung auf den Merker fehlt', [T]],
  [KR, '  K.ausgefallenGemeldet = true;\n', '', 'Ereignis doppelt: der Merker wird nie gesetzt', [T]],
  [KR, '|| K.ausgefallenGemeldet || nichtEndgueltigErledigt(K)) return false;', '|| K.ausgefallenGemeldet) return false;', 'Ereignis für bewusstlose Tiere (nichtEndgueltigErledigt nicht beachtet)', [T]],
  [KR, 'if (!K || !K.kreatur || K.weg ||', 'if (!K || K.weg ||', 'Ereignis: auch für Nicht-Kreaturen (Guard K.kreatur fehlt)', [T]],
  [KR, 'if (!K || !K.kreatur || K.weg ||', 'if (!K || !K.kreatur ||', 'Ereignis: auch für aufgelöste Tiere bei Direktaufruf (Guard K.weg fehlt)', [T]],
  [KR, "  game.emit('kreaturAusgefallen', d);\n", '', 'Ereignis: das Spielereignis fehlt', [T]],
  [KR, "  game.missionEvent('kreaturAusgefallen', d);\n", '', 'Ereignis: das Missionsereignis fehlt', [T]],
  [KR, EREIG, "x: Math.round(K.x), y: Math.round(K.y) };\n  game.emit('kreaturAusgefallen'", 'Ereignis: Feld gruppe fehlt', [T]],
  [KR, "const d = { id: K.id, typ: K.typ, gruppe:", "const d = { id: K.id, typ: K.id, gruppe:", 'Ereignis: Feld typ trägt die Kennung', [T]],
  [KR, EREIG, "gruppe: K.gruppe != null ? K.gruppe : null, x: Math.round(K.y), y: Math.round(K.x) };\n  game.emit('kreaturAusgefallen'", 'Ereignis: x und y vertauscht', [T]],
  [KR, EREIG, "gruppe: K.gruppe != null ? K.gruppe : null, x: Math.round(K.x), y: Math.round(K.y), extra: 1 };\n  game.emit('kreaturAusgefallen'", 'Ereignis: zusätzliches Feld', [T]],
  // ---- nichtEndgueltigErledigt (gemeinsame Regel)
  [KR, '(o.alive || !!LIEGT_ERHOLBAR[o.zustand] ||', '(o.alive || false ||', 'Regel: bewusstlose und gefesselte Tiere zählen als erledigt', [T]],
  [KR, 'const nichtEndgueltigErledigt = (o) => !o.weg && (o.alive ||', 'const nichtEndgueltigErledigt = (o) => (o.alive ||', 'Regel: aufgelöste (weg) Tiere zählen als nicht erledigt', [T]],
  // ---- Prüfung rudelErledigt
  [KR, '  if (!(erschienen > 0)) return false;\n', '', 'Prüfung: erschienen wird nicht geprüft (nie erschienene Gruppe gilt als erledigt)', [T]],
  [KR, '  if (!(erschienen > 0)) return false;\n', '  if (!(erschienen > 0) || (aw.kreaturen || []).filter((K) => (o.gruppe != null ? K.gruppe === o.gruppe : K.typ === o.typ)).length < erschienen) return false;\n', 'Prüfung: aufgelöste Tiere zählen nicht (alle müssten noch in der Liste stehen)', [T]],
  [KR, '  if (!G) return false;\n', '  if (!G) return true;\n', 'Prüfung: Karte ohne Buchführung gilt als erledigt', [T]],
  [KR, 'if (hat(G, o.gruppe)) erschienen = G[o.gruppe].erschienen; }', 'erschienen = hat(G, o.gruppe) ? G[o.gruppe].erschienen : 1; }', 'Prüfung: unbekannte Gruppe gilt als erschienen', [T]],
  [KR, 'if (G[k].typ === o.typ) erschienen += G[k].erschienen;', 'if (G[k].typ !== o.typ) erschienen += G[k].erschienen;', 'Prüfung: Typ-Variante zählt die falschen Gruppen', [T]],
  [KR, FILTER_K, '(o.gruppe != null ? K.gruppe === o.gruppe : K.gruppe != null && K.typ === o.typ) && nichtEndgueltigErledigt(K)) return false;', 'Prüfung: Typ-Variante übersieht Tiere ohne Gruppe', [T]],
  [KR, FILTER_K, '(o.gruppe != null ? K.typ === o.gruppe : K.gruppe === o.typ) && nichtEndgueltigErledigt(K)) return false;', 'Prüfung: Gruppe und Typ beim Vergleich vertauscht', [T]],
  [KR, FILTER_K, '(o.gruppe != null ? K.gruppe === o.gruppe : K.typ === o.typ) && K.alive) return false;', 'Prüfung: nur lebende zählen als nicht erledigt (bewusstlose gelten als erledigt)', [T]],
  [KR, 'const aw = game && game.aways && hat(game.aways, map) ? game.aways[map] : null;', 'const aw = game.away;', 'Prüfung: liest immer die aktive Karte statt der Karte map', [T]],
  [KR, 'raeumen(aw) { if (aw && aw.kreaturGruppen) delete aw.kreaturGruppen; ', 'raeumen(aw) { ', 'raeumen vergisst die Gruppen-Buchführung', [T]],
  // ---- Plugin kreaturen_erledigt
  [PL, '{ gruppe: a.gruppe, typ: a.typ }', '{ gruppe: a.typ, typ: a.gruppe }', 'Baustein: gruppe und typ vertauscht', [T]],
  [PL, 'rudelErledigt(m.game, a.map,', "rudelErledigt(m.game, '',", 'Baustein: Karte wird nicht durchgereicht', [T]],
  [PL, "params: { map: { typ: 'map', pflicht: true }, gruppe: { typ: 'string' }, typ: { typ: 'string' } },", "params: { map: { typ: 'map', pflicht: true }, gruppe: { typ: 'squad' }, typ: { typ: 'string' } },", 'Baustein: gruppe als squad (verlangt einen Regiebuch-Eintrag)', [T]],
  [PL, "id: 'kreaturen_erledigt', art: 'pruefung',", "id: 'kreaturen_erledigt', art: 'aktion',", 'Baustein: als Aktion statt als Prüfung registriert', [T]],
  // ---- Nacharbeit M1: Prüfer und Laufzeitfehler
  [PL, "    argsPruefen: (args) => Kreatur().erledigtOptionenFehler(args).map((t) => ({ code: 'PARAM-WERT', text: t })),", '', 'Prüfer: kreaturen_erledigt prüft die Parameter nicht', [T]],
  [CK, "if (typeof def.argsPruefen === 'function') for (const f of def.argsPruefen(args)) E(f.code, p, `'${name}' ${f.text}`);", '', 'Prüfer: der Aufruf von argsPruefen fehlt', [T]],
  [KR, "  if (o.gruppe == null && o.typ == null) return [\"braucht genau eines von 'gruppe' oder 'typ' (beide fehlen)\"];\n", '', 'Fehlerregel: weder gruppe noch typ wird nicht gemeldet', [T]],
  [KR, "  if (o.gruppe != null && o.typ != null) return [\"braucht genau eines von 'gruppe' oder 'typ' (beide gesetzt)\"];\n", '', 'Fehlerregel: gruppe und typ zugleich wird nicht gemeldet', [T]],
  [KR, 'if (o.typ != null && !hat(daten().typen, o.typ)) return', 'if (false) return', 'Fehlerregel: unbekannter typ (Tippfehler) wird nicht gemeldet', [T]],
  [KR, '!erledigtFehlerGemeldet.has(game)) { erledigtFehlerGemeldet.add(game);', 'true) {', 'Laufzeit: Meldung bei jedem Aufruf statt einmal', [T]],
  [KR, "game.countError('mission-kreatur', new Error('kreaturen_erledigt: ' + F[0]));", 'void 0;', 'Laufzeit: Fehler bleibt still (nur false)', [T]],
  [PL, "ereignisse: ['kreaturAusgefallen', 'kreaturAufgeloest'],", '', 'Baustein: kreatur_besetzen deklariert seine Folge-Ereignisse nicht', [T]],
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
console.log(`Mutationsprobe Erledigt (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
