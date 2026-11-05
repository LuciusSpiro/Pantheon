'use strict';
// MON-01 P2b: Mutationsprobe zu tools/test-kreatur-bausteine.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINEN
// Baustein, Hook oder Cursor-Trick und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-kreatur-bausteine.js [begriff …] [--trocken]      (npm run test:kreatur-bausteine-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-kreatur-bausteine-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-kreatur-bausteine.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const CB = 'server/sim/combat.js', WA = 'server/sim/waffen.js', KR = 'server/sim/kreatur.js';
const HOOK_E = "  if (e.kreatur) kreatur().bausteinTreffer(game, e, { x: s.x, y: s.y, pid: s.pid || null, strike: !!s.strike, flaeche: !!s.flaeche });";
const HOOK_K = "  if (k.kreatur) kreatur().bausteinTreffer(game, k, { x: q.x, y: q.y, pid: q.team === 'crew' ? q.id || null : null, flaeche: !!w.flaeche, ergebnis: r });";
const RUECKEN = "if (Math.abs(rel) >= Math.PI - (Number(ziel.ruecken.bogen) * Math.PI / 180) / 2 - EPS) schaden *= Number(ziel.ruecken.faktor) || 1;";
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Rücken
  [WA, RUECKEN, "", 'ruecken: Auswertung in waffen.trefferWirkung entfällt (kein Mehrschaden von hinten)'],
  [WA, "Math.abs(rel) >= Math.PI - (Number(ziel.ruecken.bogen)", "Math.abs(rel) >= Math.PI / 2 - (Number(ziel.ruecken.bogen)", 'ruecken: Bogen wird falsch ausgewertet (Seite zählt als Rücken)'],
  [WA, "if (ziel.ruecken && Number.isFinite(ziel.facing) && Number.isFinite(q.x)", "if (ziel.ruecken && Number.isFinite(q.x)", 'ruecken: facing wird nicht geprüft (NaN-Blickrichtung)', true],
  [KR, "  beiAusruesten(game, K, par) { if (K.ruecken == null) K.ruecken = { bogen: par.bogen, faktor: par.faktor }; },\n", "", 'ruecken: Baustein übernimmt die Parameter nicht in die Kreatur'],
  [KR, "  for (const b of Object.keys(typ.bausteine)) { const def = bausteine.get(b); if (def && def.beiAusruesten) def.beiAusruesten(game, K, typ.bausteine[b]); }\n", "", 'ausruesten ruft den Hook beiAusruesten der Bausteine nicht'],
  // ---- Treffer-Hooks (jeder Treffer genau einmal)
  [CB, HOOK_E, "", 'Hook in hitEnemy entfällt (Projektil und Orbitalschlag melden nichts)'],
  [CB, HOOK_K, "", 'Hook in trefferGemeldet entfällt (Granate, Lanze, Nahkampf melden nichts)'],
  [CB, HOOK_E, HOOK_E + "\n" + HOOK_E, 'Hook in hitEnemy doppelt (Treffer zählt zweimal)'],
  [CB, HOOK_K, HOOK_K + "\n" + HOOK_K, 'Hook in trefferGemeldet doppelt (Treffer zählt zweimal)'],
  [CB, "    if (i === 0) kreaturTrefferMelden(game, e, s);\n", "    kreaturTrefferMelden(game, e, s);\n", 'Orbitalschlag meldet jedes Segment als eigenen Treffer (statt einmal je Schlag)'],
  // ---- Aufladung
  [KR, "    const a = aufladungVon(K);\n    a.stufe = Math.min(par.max, a.stufe + 1); a.ruhe = 0; a.zerfallT = 0;", "    return;\n    const a = aufladungVon(K);\n    a.stufe = Math.min(par.max, a.stufe + 1); a.ruhe = 0; a.zerfallT = 0;", 'aufladung: beiTreffer tut nichts'],
  [KR, "a.stufe = Math.min(par.max, a.stufe + 1);", "a.stufe = a.stufe + 1;", 'aufladung: keine Obergrenze'],
  [KR, "a.stufe = Math.min(par.max, a.stufe + 1); a.ruhe = 0; a.zerfallT = 0;", "a.stufe = Math.min(par.max, a.stufe + 1);", 'aufladung: ein Treffer setzt die Wartezeit des Zerfalls nicht zurück'],
  [KR, "      a.zerfallT += dt;\n", "", 'aufladung: kein Zerfall über die Zeit'],
  [KR, "K.tempoF = 1 + s * par.tempoFaktor; ", "", 'aufladung: Stufe wirkt nicht auf das Tempo (tempoF)'],
  [KR, " K.rammF = 1 + s * par.rammFaktor; }", " }", 'aufladung: Stufe wirkt nicht auf die Rammreichweite (rammF)'],
  [KR, "const tempoVon = (K, z) => z.tempo * (K.tempoF || 1);", "const tempoVon = (K, z) => z.tempo;", 'tempoVon ignoriert den Faktor aus Bausteinen'],
  [KR, "const a = K.aufladung; if (!a || a.stufe <= 0) return;", "const a = aufladungVon(K); if (a.stufe <= 0) return;", 'aufladung: beiTick legt die Ladung ohne Treffer an (Basiswert nicht mehr "keine Ladung")'],
  // ---- Köder und Lärm-Leser
  [KR, "    for (const ev of neu) bausteinLaerm(game, K, ev);\n", "", 'Lärm-Leser: Ereignisse werden nicht an die Bausteine verteilt'],
  [KR, "    if (Math.hypot(ev.x - K.x, ev.y - K.y) > ev.radius * par.faktor) return;\n", "", 'koeder: keine Hörweite (reagiert auf jeden Lärm)'],
  [KR, "> ev.radius * par.faktor) return;", "> ev.radius) return;", 'koeder: Faktor der Hörweite wird ignoriert'],
  [KR, "    if (jagend(K, typ)) return;\n", "", 'koeder: Jagd-Prüfung in beiLaerm entfällt (beiTick verwirft das Ziel im selben Tick noch vor dem Zustandswechsel, daher nicht beobachtbar)', true],
  [KR, "  beiTick(game, K, dt, par, ctx) { if (K.koeder && jagend(K, ctx.typ)) K.koeder = null; },   // Jagd geht vor\n", "", 'koeder: Jagd verwirft das Köder-Ziel nicht'],
  [KR, "    if (z.modus !== KOEDER_MODUS && !z.uebergang.some((u) => u.auf === 'laerm')) return;\n", "", 'koeder: reagiert auch in Zuständen ohne Übergang laerm'],
  [KR, "    laerm: (game, K) => !!K.koeder && !K.koeder.fertig,", "    laerm: (game, K) => false,", 'koeder: Auslöser laerm löst nie aus'],
  [KR, "        else if ((o.rest -= dt) <= 0) o.fertig = true;", "        else o.rest -= dt;", 'koeder: Suche am Ort endet nie'],
  [KR, "          if (!a || !Monster.setzePfad(K, ctx.m, a)) o.da = true;", "          if (!a) o.da = true;", 'koeder: Pfad wird nie gesetzt (geht nicht zum Ort)'],
  [KR, "K.laermCursor = laermCursorAnlegen(aw);", "K.laermCursor = { t: -1e9, n: 0 };", 'Cursor: beim Anlegen nicht auf den Pufferstand gesetzt (liest die Altlast)'],
  [KR, "    if (ev.t === c.t) { if (++gleich <= c.n) continue; c.n++; }", "    if (ev.t === c.t) continue;", 'Cursor: Ereignisse gleicher Tickzeit gehen verloren (ev.t > cursor wie in squad.js)'],
  [KR, "    const neu = laermLesen(aw, K);", "    const neu = laermLesen(aw, K); if (aw.laerm && aw.laerm.length) aw.laerm.shift();", 'Leser verändert aw.laerm'],
  [KR, "    const neu = laermLesen(aw, K);", "    const neu = laermLesen(aw, K); aw.laermGelesen = game.time;", 'Leser schreibt aw.laermGelesen (Trupp-Leser verändert)'],
  // ---- Ramm-Schaden
  [KR, "    if (ctx.typ.zustaende[K.z].modus !== 'ramme' || game.god) return;", "    if (ctx.typ.zustaende[K.z].modus !== 'ramme') return;", 'rammschaden: game.god schützt nicht'],
  [KR, "    if (ctx.typ.zustaende[K.z].modus !== 'ramme' || game.god) return;", "    if (game.god) return;", 'rammschaden: verwundet auch außerhalb des Rammens'],
  [KR, "    const r = par.radius * (K.rammF || 1);", "    const r = par.radius;", 'rammschaden: Ladung wirkt nicht auf die Reichweite'],
  [KR, "      combat().woundPlayer(game, p, 'kreatur');\n", "", 'rammschaden: keine Wunde'],
  [KR, "      K.rammTreffer = true;\n", "", 'rammschaden: Treffer beendet das Rammen nicht (Auslöser getroffen)'],
  [KR, "      game.missionEvent('kreaturTreffer', { pid: p.id, id: K.id });\n", "", 'rammschaden: Missionsereignis kreaturTreffer fehlt'],
  [KR, "      if (p.zone !== 'away' || p.connected === false || p.downed || p.lift) continue;\n", "      if (p.zone !== 'away') continue;\n", 'rammschaden: liegende Spieler werden erneut verwundet'],
  [KR, "      if (!Los.lineOfSight(ctx.E.shotBlocked, K.x, K.y, p.x, p.y)) continue;", "", 'rammschaden: keine Sichtlinienprüfung (Berührung durch Wand oder Fenster)'],
  [KR, "    if (K.rammTreffer) return;", "", 'rammschaden: nach dem Treffer weiter prüfen (ohne Übergang getroffen trifft das Rammen alle Spieler nacheinander)'],
  [KR, "p.connected === false || ", "", 'rammschaden: getrennte Spieler (connected=false) werden gerammt'],
  [KR, " || p.lift) continue;", ") continue;", 'rammschaden: Spieler im Lift (p.lift) werden gerammt'],
  [KR, "gehe(game, K, dt, ctx, tempoVon(K, z)); if (!K.pfad.length && !K.ramm) o.da = true;", "gehe(game, K, dt, ctx, z.tempo); if (!K.pfad.length && !K.ramm) o.da = true;", 'koeder: Gang zum Ort ignoriert den Tempofaktor der Ladung (tempoF)'],
  [KR, "if (++gleich <= c.n) continue; c.n++; }", "if (++gleich <= c.n) continue; }", 'Cursor: n zählt bei gleicher Tickzeit nicht hoch (zweites Ereignis wird jeden Tick neu gelesen)'],
  [KR, "K.blockiert = false; K.rammTreffer = false; K.ramm = null;", "K.blockiert = false; K.ramm = null;", 'betreten: Treffer-Merker wird nicht zurückgesetzt'],
  [KR, "  ausloeser: { getroffen: (game, K) => !!K.rammTreffer },", "  ausloeser: { getroffen: (game, K) => false },", 'rammschaden: Auslöser getroffen löst nie aus'],
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
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 120000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-kreatur-bausteine.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  // Abschnitt-Abbruch durch eine Ausnahme zählt hier als Erkennung nur, wenn zugleich eine Prüfzeile rot ist; sonst Absturz
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß (nicht getestet)'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
