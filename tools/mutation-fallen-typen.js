'use strict';
// ITM-01 D: Mutationsprobe zu tools/test-fallen-typen.js (Schott, Druckverlust/Gefahrenfeld, Selbstschussanlage). Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt
// unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-fallen-typen.js [begriff …] [--trocken]      (npm run test:fallen-typen-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
// Einträge mit 5. Element true sind als gleichwertig begründet (keine Beobachtung möglich) und müssen überleben.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-fallen-typen-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-fallen-typen.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const FT = 'server/sim/fallen-typen.js', FA = 'server/sim/fallen.js', IN = 'server/sim/interior.js', BU = 'shared/buehne.js', CF = 'shared/config.js', LP = 'server/sim/landepunkte.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- alle Typen: genau einmal, Ziele, Gegner
  [FA, "try { h(game, aw, f, p || null); }", "try { h(game, aw, f, p || null); h(game, aw, f, p || null); }", 'Wirkung doppelt (Handler zweimal gerufen)'],
  [FT, " && !p.downed && !p.beamLock", " && !p.beamLock", 'Liegende (downed) sind Ziele'],
  [FT, "return p.zone === 'away' && p.connected", "return p.connected", 'Spieler an Bord sind Ziele'],
  [FT, " && (p.zustand || 'ok') === 'ok';", ";", 'Bewusstlose (zustand) sind Ziele', true],   // gleichwertig: combat.folgenAbgleich setzt downed aus zustand (verwundet, bewusstlos, gefesselt) in jedem Tick, !p.downed fängt sie schon ab; die zustand-Prüfung ist Doppelabsicherung
  [FT, "      if (!ende) return true;\n      gm.emit('falleFeld', ev(0));", "      for (const e of w.drones || []) if (e.alive) combat().hitEnemy(gm, e, C.segmente, { x: f.px, y: f.py });\n      if (!ende) return true;\n      gm.emit('falleFeld', ev(0));", 'Schaden an Gegner (Gefahrenfeld)'],
  [FT, "  if (!q) return false;\n  game.emit('selbstschuss'", "  if (!q) { for (const e of aw.drones || []) if (e.alive) cb.hitEnemy(game, e, C.segmente, { x: f.px, y: f.py }); return false; }\n  game.emit('selbstschuss'", 'Schaden an Gegner (Selbstschuss ohne Spielerziel)'],
  // ---- Schott
  [FT, "      if (belegt(game, aw, q)) continue;   // nie in eine feste Kachel hinein: später noch einmal\n", "", 'Schott schließt auf besetzter Kachel (Einsperren)'],
  [FT, "      rec[q.id] = { von: f.id, vorher: z };", "      rec[q.id] = { von: f.id, vorher: 'offen' };", 'Schott kehrt immer auf offen zurück (Zustand davor vergessen)'],
  [FT, "if (Anker.setzen(game, aw.map, q.id, 'zu', p ? p.id : null))", "if (Anker.setzen(game, aw.map, q.id, 'verschlossen', p ? p.id : null))", 'Schott geht auf verschlossen (nicht hackbar) statt zu'],
  [FT, "    if (e.t < C.dauer - EPS) { if (wartend.length) schritt(); return true; }", "    if (true) { if (wartend.length) schritt(); return true; }", 'Schott öffnet nie (Dauer endet nicht)'],
  [FT, "        if (Anker.zustand(gm, w.map, id) === 'zu') Anker.setzen(gm, w.map, id, r.vorher, null);", "", 'Schott öffnet nie (Öffnen fehlt)'],
  [FT, "        if (Anker.zustand(gm, w.map, id) === 'zu') Anker.setzen(gm, w.map, id, r.vorher, null);", "        Anker.setzen(gm, w.map, id, r.vorher, null);", 'Öffnen überschreibt ein früher gehacktes Schott'],
  [BU, "!tor.has(k.id) && ", "", 'Kante eines Rätseltors schließt sich auch'],
  [BU, "k.tiles.some((t) => Math.hypot(t[0] - a.x, t[1] - a.y) <= r)", "k.tiles.some((t) => true)", 'Schott-Radius ignoriert (alle Schotts der Karte)'],
  [FT, "  if (!kanten.length) { wirkungslos(game, aw, f, p, 'kein_schott'); return; }", "  if (!kanten.length) { return; }", 'ohne Schott: stille Wirkungslosigkeit (kein Ereignis, kein Hinweis)'],
  [BU, "!fallenSchottKanten(karte, a, rr).length) Wn('K-FALLE'", "false) Wn('K-FALLE'", 'Prüfer meldet die wirkungslose Schott-Falle nicht'],
  [LP, "try { require('./fallen-typen.js').beimSichern(aw, z, start, k); }", "try { /* */ }", 'Weltstand speichert geschlossene Schotts als zu'],
  // ---- Druck / Gefahrenfeld
  [FT, "        if (acc[q.id] >= C.takt - EPS) {", "        if (true) {", 'Takt ignoriert (Schaden jeden Tick)'],
  [FT, "      const ende = e.t >= C.dauer - EPS;", "      const ende = false;", 'Dauer endet nicht (Gefahrenfeld läuft endlos)'],
  [FT, "        if (!trifft(q) || !imBereich(b, f, q)) { delete acc[q.id]; continue; }", "        if (!trifft(q) || !imBereich(b, f, q)) { continue; }", 'Verlassen des Raums setzt den Takt nicht zurück'],
  [FT, "  if (b.rect) { const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE); return tx >= b.rect[0] && ty >= b.rect[1] && tx < b.rect[0] + b.rect[2] && ty < b.rect[1] + b.rect[3]; }", "  if (b.rect) { return true; }", 'Spieler außerhalb des Raums werden getroffen'],
  [FT, "combat().hitPlayer(gm, q, C.segmente, { kind, x: f.px, y: f.py });", "combat().hitPlayer(gm, q, 1, { kind, x: f.px, y: f.py });", 'Segmente aus der Config ignoriert (immer 1)'],
  [FT, "combat().hitPlayer(gm, q, C.segmente, { kind, x: f.px, y: f.py });", "combat().hitPlayer(gm, q, C.segmente, { kind: 'x', x: f.px, y: f.py });", 'Quelle des Gefahrenfelds nicht aus der Config (kind)'],
  [FT, "  if (C.bereich !== 'radius' && k) {", "  if (false) {", 'Raum-Bereich ignoriert (immer Radius)'],
  // ---- Selbstschuss
  [FT, "if (combat().losBetween(E, von, c.q)) return c.q;", "return c.q;", 'Sichtlinie ignoriert (Schuss durch die Wand)'],
  [FT, " && Math.hypot(q.x - f.px, q.y - f.py) <= reich)\n", ")\n", 'Reichweite ignoriert'],
  [FT, ".sort((a, b) => a.d - b.d || a.i - b.i);", ".sort((a, b) => b.d - a.d || a.i - b.i);", 'Ziel ist der Fernste statt der Nächste'],
  [FT, "e.t >= C.verzug + n * C.takt - EPS", "e.t >= C.verzug - EPS", 'Salve ohne Takt (alle Schüsse im selben Tick)'],
  [FT, "    while (n < C.schuesse && e.t", "    while (n < C.schuesse - 1 && e.t", 'Salve zu kurz (ein Schuss fehlt)'],
  [FT, "    return n < C.schuesse;\n  });", "    return true;\n  });", 'Salve-Zeitwirkung endet nie', true],   // gleichwertig: nach schuesse Schuss tut die Zeitwirkung nichts mehr (nur Tickzeit, vom Tickmaß erfasst)
  [FT, "cb.hitPlayer(game, q, C.segmente, { kind: 'selbstschuss', x: f.px, y: f.py });", "cb.hitPlayer(game, q, C.segmente, { kind: 'schuss', x: f.px, y: f.py });", 'Quelle des Schusses falsch (kind)'],
  [FT, "cb.hitPlayer(game, q, C.segmente, { kind: 'selbstschuss', x: f.px, y: f.py });", "cb.hitPlayer(game, q, 2, { kind: 'selbstschuss', x: f.px, y: f.py });", 'Schuss mit 2 Segmenten statt Config'],
  // ---- Blockade (Kollisionsbox) und Auslösezone der Anlage
  [IN, "return !!ki.solid || (blk !== null && blk.has(ty * bw + tx));", "return !!ki.solid;", 'Blockade fehlt (Spieler laufen durch die Anlage)'],
  [CF, "        blockiert: { schuss: true },", "        blockiert: {},", 'Blockade fehlt in der Config (Typ schuss nicht blockierend)'],
  [CF, "        blockiert: { schuss: true },", "        blockiert: { schuss: true, druck: true },", 'Blockade für jeden Typ (auch druck)'],
  [IN, "|| c.sig !== sig) {", ") {", 'Kollisionscache folgt der Config nicht'],
  [CF, "radius: { standard: 0.6, schott: 0.6, druck: 0.5, schuss: 0.9 }", "radius: { standard: 0.6, schott: 0.6, druck: 0.5, schuss: 0.7 }", 'Auslösezone der Anlage innerhalb der Kollisionsbox (Berühren löst nie aus)'],
  [CF, "radius: { standard: 0.6, schott: 0.6, druck: 0.5, schuss: 0.9 }", "radius: { standard: 0.6, schott: 0.6, druck: 0.5, schuss: 1.4 }", 'Auslösezone der Anlage größer als der Entschärfen-Abstand'],
  [BU, "    if (rolle === 'falle') return a ? objektRolle(D, rolle) && ankerBlockiert(a) : false;", "    if (rolle === 'falle') return false;", 'Prüfer kennt die blockierende Anlage nicht (Weg gesperrt, K-ERREICHBAR schweigt)'],
  [IN, "if (!e.verborgen || (zs[e.id] && zs[e.id] !== 'verborgen'))", "if (true)", 'G S1: verborgene Anlage blockiert schon auf dem Server (verrät die Falle, Prediction-Ruck)'],
  [IN, "zs[e.id] !== 'verborgen'))", "zs[e.id] === 'xx'))", 'G S1: enthüllte (erkannte/ausgelöste) Anlage blockiert nicht mehr'],
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
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 180000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-fallen-typen.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (keine Beobachtung möglich): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
