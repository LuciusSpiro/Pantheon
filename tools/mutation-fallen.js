'use strict';
// ITM-01 C: Mutationsprobe zu tools/test-fallen.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-fallen.js [begriff …] [--trocken]      (npm run test:fallen-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
// Einträge mit 5. Element true sind als gleichwertig begründet (keine Beobachtung möglich) und müssen überleben.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-fallen-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-fallen.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const CX = 'server/mission/context.js', SB = 'server/sim/scanbar.js', FA = 'server/sim/fallen.js', AN = 'server/sim/anker.js', GM = 'server/game.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Auslösen
  [FA, "  if (!f || !AKTIV(zustandVon(aw, f))) return false;", "  if (!f) return false;", 'Auslösen doppelt (Zustandsprüfung in ausloesen fehlt)'],
  [FA, "    if (!AKTIV(zustandVon(aw, f))) continue;\n    const r = radius", "    const r = radius", 'Update prüft den Zustand nicht (nur ausloesen schützt)', true],   // gleichwertig: ausloesen() lehnt ausgelöste/entschärfte Fallen selbst ab
  [FA, "      ausloesen(game, aw, f, p);\n      break;", "      ausloesen(game, aw, f, p);", 'nach dem ersten Auslöser weiter prüfen (zweiter Spieler im selben Tick)', true],   // gleichwertig: der zweite Aufruf scheitert an der Zustandsprüfung in ausloesen
  [FA, "if (Math.hypot(p.x - f.px, p.y - f.py) > r) continue;", "if (Math.hypot(p.x - f.px, p.y - f.py) > r * 3) continue;", 'Auslösezone dreifach (Nachbarkachel löst aus)'],
  [FA, "if (p.zone !== 'away' || p.connected === false || p.downed || p.beamLock) continue;", "if (p.zone !== 'away' || p.connected === false || p.beamLock) continue;", 'verwundeter Spieler löst aus'],
  [FA, "if (p.zone !== 'away' || p.connected === false || p.downed || p.beamLock) continue;", "if (p.connected === false || p.downed || p.beamLock) continue;", 'Spieler an Bord löst aus'],
  [FA, "  const err = Anker.setzen(game, aw.map, f.id, 'ausgeloest', p ? p.id : null, Object.assign({}, opts, { ausloesen: true }));", "  const err = null;", 'Auslösen setzt den Zustand nicht'],
  [FA, "q.hold = null; meldung(game, q, 'Zu spät – die Falle ist ausgelöst.');", "", 'Entschärfer wird beim Auslösen nicht abgebrochen/benachrichtigt'],
  [FA, "  game.missionEvent('falleAusgeloest',", "  game.emit('falleAusgeloest',", 'Missions-Ereignis falleAusgeloest fehlt'],
  [FA, "  const h = wirkungen.get(f.typ);\n  if (h) {", "  const h = null;\n  if (h) {", 'Wirkung wird nicht aufgerufen'],
  // ---- Register, Zeitwirkung
  [FA, "  if (wirkungen.has(typ)) throw new Error('fallenWirkung: Typ bereits angemeldet (' + typ + ')');", "", 'Register: Doppel-Id wirft nicht'],
  [FA, "  return () => { if (wirkungen.get(typ) === handler) wirkungen.delete(typ); };", "  return () => {};", 'Register: Abmelder tut nichts'],
  [FA, "weiter = e.fn(game, aw, dt, e) !== false; }", "weiter = e.fn(game, aw, dt, e) !== false || true; }", 'Zeitwirkung endet nie'],
  [FA, "    for (const e of s.laufend.slice()) {\n      e.t += dt;", "    for (const e of s.laufend.slice()) {", 'Zeitwirkung: Zeit zählt nicht'],
  // ---- Zustandsmaschine, Start, ao
  [FA, "const UEBERGAENGE = { verborgen: ['erkannt', 'ausgeloest'], erkannt: ['entschaerft', 'ausgeloest'], entschaerft: [], ausgeloest: [] };", "const UEBERGAENGE = { verborgen: ['erkannt', 'ausgeloest'], erkannt: ['entschaerft', 'ausgeloest', 'verborgen'], entschaerft: [], ausgeloest: ['erkannt'] };", 'Zustandsmaschine: erkannt -> verborgen und ausgeloest -> erkannt erlaubt'],
  [AN, "&& !fallenMod().uebergangErlaubt(vorher, z)) return", "&& false) return", 'setzen lehnt ungültige Übergänge nicht ab'],
  [AN, "function startFuer(a) { return a.rolle === 'falle' && a.sicht === 'passiv' ? 'erkannt' : startZustand(a.rolle); }", "function startFuer(a) { return startZustand(a.rolle); }", 'passive Falle startet als verborgen'],
  [AN, "if (zi >= 0 && z !== startFuer(a)) ao.push([i, zi]);", "if (zi > 0) ao.push([i, zi]);", 'ao sendet den Start einer passiven Falle als Abweichung'],
  [AN, "const al = ankerListe(game, aw, k);", "const al = k.anker;", 'ao-Index nicht konsistent (Karten-Ankerliste statt Payload-Reihenfolge)'],
  // ---- Payload, Enthüllen, Nachsendung
  [AN, "const verdeckt = (a) => a.rolle === 'falle' && a.sicht !== 'passiv';", "const verdeckt = (a) => false;", 'verborgene Falle steht im Payload'],
  [GM, "const anker = (fnA ? fnA(k) : (k.anker || [])).map(", "const anker = (k.anker || []).map(", 'awayMapPayload ignoriert payloadAnker'],
  [GM, "  if (a.rolle === 'falle') { if (a.typ) attr.typ = a.typ;", "  if (false) { if (a.typ) attr.typ = a.typ;", 'Payload-Zeile der Falle ohne typ und sicht'],
  [AN, "ids.map((id) => ankerById(k, id)).filter(Boolean)) : p;", "ids.map((id) => ankerById(k, id)).filter(Boolean).reverse()) : p;", 'ankerListe hängt die Enthüllten umgekehrt an (ao-Index passt nicht zur Client-Liste)'],
  [FA, "    s.enth.push(f.id);\n", "", 'Enthüllen wird nicht gemerkt'],
  [AN, "  if (rolle === 'falle' && vorher !== z) safe(game, 'falle-zustand', () => fallenMod().beiZustand(game, aw, a, z));", "", 'setzen ruft den Enthüllen-Hook nicht'],
  [FA, "i: basis + rec.n,", "i: basis,", 'ankerEnthuellt: Index i falsch'],
  [FA, "      rec.n++;\n    }", "      rec.n = s.enth.length;\n    }", 'Nachsendung: nur der erste Anker je Durchlauf'],
  [FA, "if (rec.ep !== -1 && rec.n > 0) { game.sendAwayMap(p, aw.map); rec = p.awayEnth[aw.map]; }", "", 'Neuaufbau der Außenkarte: Karte wird dem Client nicht neu gesendet'],
  [GM, "    (p.awayEnth || (p.awayEnth = {}))[lp] = { ep: -1, n: 0 };", "", 'neu gesendete Karte setzt den Nachsende-Zähler nicht zurück'],
  [GM, "    Fallen.nachreichen(this, aw, key, k);", "", 'Fallen.nachreichen wird nie aufgerufen'],
  [FA, "  for (const f of liste) if (f.sicht === 'verborgen' && zustandVon(aw, f) !== 'verborgen') s.enth.push(f.id);", "", 'Weltstand: Enthüllte werden beim Neuaufbau nicht abgeleitet'],
  // ---- Scanner
  [SB, "if (z.bei && stufe >= z.tiefen.position) {", "if (z.bei) {", 'Falle wird schon bei Stufe 1 erkannt und enthüllt'],
  [FA, "tiefen: { position: CONFIG.anker.falle.position }", "tiefen: { position: 1 }", 'Positionsstufe 1 statt 2'],
  [FA, "for (const f of s.liste) if (AKTIV(zustandVon(aw, f))) out.push(", "for (const f of s.liste) out.push(", 'ziele liefert auch entschärfte und ausgelöste Fallen'],
  [FA, "if (f && zustandVon(aw, f) === 'verborgen') Anker.setzen(game, aw.map, f.id, 'erkannt', p ? p.id : null);", "", 'Scan erkennt die Falle nicht (kein Zustandswechsel)'],
  // ---- Entschärfen
  [AN, "case 'falle': return z === 'erkannt' && h.map === aw.map && !p.downed;", "case 'falle': return z !== 'ausgeloest' && h.map === aw.map && !p.downed;", 'Entschärfen auch aus verborgen/entschärft gültig (holdValid)'],
  [AN, "case 'falle': return z === 'erkannt' && h.map === aw.map && !p.downed;", "case 'falle': return z === 'erkannt' && !p.downed;", 'Hold gilt auf jeder Karte (Kartenwechsel)'],
  [AN, "case 'falle': if (z === 'erkannt') it({ op: 'entschaerfen', map: aw.map }); break;", "case 'falle': if (z !== 'ausgeloest') it({ op: 'entschaerfen', map: aw.map }); break;", 'E bietet Entschärfen auch bei verborgener Falle an (verrät sie)'],
  [AN, "  } else if (h.kind === 'anker:falle') {\n    p.hold = null;", "  } else if (h.kind === 'anker:falle') {\n    p.hold = p.hold;", 'Treffer unterbricht das Entschärfen nicht'],
  [AN, "      setzen(game, map, a.id, 'entschaerft', p.id);\n", "", 'Zustand nach dem Entschärfen nicht gesetzt'],
  [AN, "      game.missionEvent('falleEntschaerft',", "      game.emit('falleEntschaerft',", 'Missions-Ereignis falleEntschaerft fehlt'],
  [AN, "      if (zustandIn(aw, k, a.id) !== 'erkannt') return;\n      setzen(", "      setzen(", 'completeHold entschärft ohne Zustandsprüfung', true],   // gleichwertig: setzen lehnt jeden Übergang aus ausgeloest/entschaerft heraus ab, nur der sfx-Ton und das Missions-Ereignis liefen dann doppelt (kein Zustand, kein Snapshot)
  [AN, "  return H[rolle] || 1;\n}", "  if (rolle === 'falle') return 0.5;\n  return H[rolle] || 1;\n}", 'Haltezeit nicht aus der Config'],
  // ---- Debug
  [FA, "  if (!game.debug) return 'falletest: nur mit Server --debug.';", "", 'falletest auch ohne --debug'],
  [FA, "  k.anker = k.anker.filter((a) => !/^falle\\.test\\d+$/.test(a.id));", "", 'falletest ersetzt alte Test-Fallen nicht'],
  // ---- ITM-01 G: H1 (setzen -> ausgeloest löst echt aus), H2 (Nachzügler bekommt dieselbe Liste)
  [AN, "if (rolle === 'falle' && z === 'ausgeloest' && vorher !== z && !o.ausloesen) {", "if (false) {", 'G H1: anker.setzen nach ausgeloest löst keine Wirkung aus (Baustein, Debug)'],
  [FA, "  const p = pid ? game.playerById(pid) : null;\n", "  const p = null;\n", 'G H1: Auslöser (pid) geht beim Auslösen über setzen verloren'],
  [FA, "      if (a) game.sendTo(p.conn, { t: 'event', kind: EVT_ENTHUELLT, map: aw.map, kv: key.slice(aw.map.length + 1), i: basis + rec.n, anker: game.ankerZeile(a) });", "      if (a && rec.ep !== -2) game.sendTo(p.conn, { t: 'event', kind: EVT_ENTHUELLT, map: aw.map, kv: key.slice(aw.map.length + 1), i: basis + rec.n + (p.clientId === 'F9' ? 1 : 0), anker: game.ankerZeile(a) });", 'G H2: Nachzügler bekommt die Enthüllten mit falschem Index'],
  // ---- ITM-01 H: Spielleiter-Kontext
  [CX, "&& !verborgeneFalle(a, zust)) z[a.rolle]", ") z[a.rolle]", 'H: Kontext zählt verborgene Fallen mit'],
  [CX, "((zust && zust[a.id]) || 'verborgen') === 'verborgen'", "true", 'H: Kontext zählt auch enthüllte (erkannte/ausgelöste) Fallen nicht mehr'],
  [CX, "a.sicht !== 'passiv' && ((zust", "((zust", 'H: Kontext zählt passive (von Anfang an erkannte) Fallen nicht'],
  [CX, "r.anker = zahlen(k.anker, obj(e.zustaende));", "r.anker = zahlen(k.anker);", 'H: Kontext ignoriert den Weltstand-Zustand der Fallen'],
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
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-fallen.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
