'use strict';
// SUND-04b B2: Mutationsprobe zu tools/test-faden-katalog-b2.js (Szenen konvoi und geleit in faden-szene-b2.js und faden-szene.js; Baustein sabotage, Lage, Pause und Stand in faden-b2.js; Pruefer-Regel Lage; Frist je Beat und Stand in
// faden.js; Expander, Prompt und Mock; Daten). Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0 mit
// mindestens einer FEHLER-Zeile). Ueberlebt eine Mutation, deckt der Test die Regel nicht ab. Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab.
//   node tools/mutation-faden-katalog-b2.js [begriff ...] [--trocken]      (npm run test:faden-katalog-b2-mutation)
// Bewusst nicht in der Liste (aequivalente Mutanten): die Pruefung hex ungueltig in update() (der Beat setzt parameter.ort beim Beginn auf einen gueltigen Hex, ein ungueltiger kann nicht vorkommen), der Zwischenspeicher
// gefragt in pruefeLage (dieselbe Lage zweimal zu fragen aendert das Ergebnis nicht), die Pruefung des Typs von key vor B2.lage (lage() lehnt jeden Nicht-Namen ab), reine Zahlen der Daten ohne zweite Erwartung im Test
// (huelle, ring, vorlauf), das Aufraeumen der Konvoi-Schiffe nach e.kv (die Schiffe tragen den Tag der Szene, faden-szene.js raeumt sie ohnehin ab), der Rueckgabewert von beginn() bei fehlendem Schuetzling (kampfTakt scheitert einen Tick spaeter ohnehin), die Sortierung der Ziele (die Breitensuche liefert sie schon nach Spruengen und Hex), nscVon im Takt (dasselbe Objekt wie f.nsc), die Form-Pruefung des Leser-Blocks (Feld und Text haben kein t), der Stand nur mit Pause (ein Beat laeuft nur mit einem Faden), das Muster des Beat-Namens im Schema von sund_frei (der Validator des Katalogs prueft kein pattern, der Querverweis lehnt jeden unbekannten Namen ab), die Mindestlaenge der Texte (8 Zeichen) in katalogFehler.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-b2-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-katalog-b2.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js', 'gegner-testhilfe.js', 'katalog.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const SB = 'server/sim/faden-szene-b2.js', FS = 'server/sim/faden-szene.js', B2 = 'server/sim/faden-b2.js', PR = 'server/sim/faden-pruefer.js', FA = 'server/sim/faden.js',
  AP = 'server/sim/abenteuer-prompt.js', AM = 'server/sim/abenteuer-mock.js', DB = 'content/faeden/beats.json', DS = 'content/faeden/szenen-werte.json', DT = 'content/faeden/b2-texte.json', SYS = 'content/spielleiter/prompts/abenteuer.system.md',
  KM = 'server/mission/katalog.js', KS = 'content/katalog/schema/molekuel.schema.json', MK = 'content/katalog/molekuele/konvoi_abfangen.json', MS = 'content/katalog/molekuele/schuetzen.json', MP = 'content/katalog/molekuele/pannenhilfe.json',
  SCH = 'content/schema/weltstand.schema.json', RE = 'server/sim/reise-ereignis.js', BS = 'server/sim/faden-bausteine.js', BPF = 'server/sim/faden-bauplan.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Szenen: Plan (Wahl des Beats, Zahl, Texte)
  [SB, "return typeof v === 'string' && liste.includes(v) ? v : standard; };", "return typeof v === 'string' ? v : standard; };", 'Szene: der Parameter des Beats (sieg, modus) wird nicht gegen die Daten geprueft'],
  [SB, "textKey: sieg === 'pluendern' ? 'konvoi_pluendern' : 'konvoi',", "textKey: 'konvoi',", 'Konvoi: die Pluenderung hat keinen eigenen Text'],
  [SB, "n: nachCrew(K.anzahl, crew),", "n: K.anzahl['1'],", 'Konvoi: die Zahl der Transporter ignoriert die Crewgroesse'],
  [SB, "eskorte: has(K.eskorte, k) ? K.eskorte[k] : 'voll' };", "eskorte: 'voll' };", 'Konvoi: die Eskorte ignoriert die Crewgroesse'],
  [SB, "n: nachCrew(G.modi[modus].angreifer, crew), modus };", "n: G.modi[modus].angreifer['1'], modus };", 'Geleit: die Zahl der Angreifer ignoriert die Crewgroesse'],
  [SB, "const G = W.geleit, modus = wahl(it, 'modus', Object.keys(G.modi), G.modus_standard);", "const G = W.geleit, modus = G.modus_standard;", 'Geleit: der Modus des Beats wird ignoriert'],
  [SB, "const K = W.konvoi, sieg = wahl(it, 'sieg', K.siegen, K.sieg_standard);", "const K = W.konvoi, sieg = K.sieg_standard;", 'Konvoi: der Sieg des Beats wird ignoriert'],
  // ---- Szenen: Beginn
  [SB, "wiederholung: false, volk: K.volk });", "wiederholung: true, volk: K.volk });", 'Konvoi: ein entkommener Konvoi kommt wieder'],
  [SB, "ladung: K.ladung, wiederholung", "ladung: 'sprengstoff', wiederholung", 'Konvoi: die Beute ist der Sprengstoff der Kampagne'],
  [SB, "sieg: p.sieg, ladung", "sieg: 'aufhalten', ladung", 'Konvoi: die Siegart wird nicht an den Konvoi gegeben'],
  [SB, "eskorte: p.eskorte, sieg", "eskorte: 'voll', sieg", 'Konvoi: die Eskorte wird nicht an den Konvoi gegeben'],
  [SB, "n: fs.n, eskorte: p.eskorte", "n: 2, eskorte: p.eskorte", 'Konvoi: die angekuendigte Zahl der Transporter ist nicht die, die kommt'],
  [SB, "volk: K.volk });", "});", 'Konvoi: das Volk des Konvois kommt nicht aus den Daten'],
  [SB, "huelle: M.huelle, reparatur_s: M.reparatur_s });", "huelle: 100, reparatur_s: M.reparatur_s });", 'Geleit: die Huelle des Schuetzlings kommt nicht aus den Daten'],
  [SB, "huelle: M.huelle, reparatur_s: M.reparatur_s });", "huelle: M.huelle, reparatur_s: 0 });", 'Geleit: die Reparaturzeit kommt nicht aus den Daten'],
  [SB, "const nach = M.verhalten === 'folgt_kurs' ? ferneSeite(game, G.ziele) : null;", "const nach = 'ost';", 'Geleit: jeder Schuetzling faehrt nach Osten (auch der Havarist)'],
  [SB, "if (d > bd) { bd = d; best = s; }", "if (bd < 0 || d < bd) { bd = d; best = s; }", 'Geleit: das Ziel ist die naehere Seite'],
  [SB, "tag: fs.tag, volk: A.volk, ziel: fs.tag });", "tag: fs.tag, volk: A.volk });", 'Geleit: die Angreifer greifen die Lerche statt des Schuetzlings an'],
  [SB, "tag: fs.tag, volk: A.volk, ziel: fs.tag });", "volk: A.volk, ziel: fs.tag });", 'Geleit: die Angreifer tragen nicht den Tag der Szene'],
  [SB, "name = fs.nsc && fs.nsc.schiff ? fs.nsc.schiff : undefined;", "name = undefined;", 'Geleit: der Schuetzling traegt nicht den Namen des Schiffs des NSC'],
  [SB, "if (!es) return false;\n  const A = G.angreifer;", "const A = G.angreifer;", 'Geleit: ohne Schuetzling kommen trotzdem Angreifer'],
  [SB, "for (let i = 0; i < fs.n; i++) {\n    const a = (i / Math.max(1, fs.n))", "for (let i = 0; i < fs.n + 1; i++) {\n    const a = (i / Math.max(1, fs.n))", 'Geleit: es kommt ein Angreifer mehr als angekuendigt'],
  // ---- Szenen: Ausgang
  [SB, "if (Konvoi.ausgang(game)) return Konvoi.erfolg(game) ? 'gelungen' : 'gescheitert';", "if (Konvoi.ausgang(game)) return 'gelungen';", 'Konvoi: ein entkommener Konvoi gilt als gelungen'],
  [SB, "if (!Konvoi.aktiv(game) || dauer > W.konvoi.max_s) return 'gescheitert';", "if (dauer > W.konvoi.max_s) return 'gescheitert';", 'Konvoi: ein verschwundener Konvoi beendet die Szene nicht'],
  [SB, "if (!Konvoi.aktiv(game) || dauer > W.konvoi.max_s) return 'gescheitert';", "if (!Konvoi.aktiv(game)) return 'gescheitert';", 'Konvoi: keine Hoechstdauer'],
  [SB, "if (!es) return 'gescheitert';", "if (!es) return null;", 'Geleit: ein verschwundener Schuetzling beendet die Szene nicht'],
  [SB, "if (es.state === 'kampfunfaehig' || es.state === 'zerstoert') return 'gescheitert';", "if (es.state === 'zerstoert') return 'gescheitert';", 'Geleit: ein kampfunfaehiger Schuetzling beendet die Szene nicht'],
  [SB, "if (M.erfolg === 'angekommen' && es.arrived) return 'gelungen';", "if (M.erfolg === 'angekommen' && false) return 'gelungen';", 'Geleit: die Ankunft am Ziel gilt nicht'],
  [SB, "if (M.erfolg === 'repariert' && es.repaired) return 'gelungen';", "if (M.erfolg === 'repariert' && false) return 'gelungen';", 'Geleit: die Reparatur gilt nicht'],
  [SB, "if (M.erfolg === 'angreifer_weg' && !game.space.enemies.some((e) => e.tag === fs.tag)) return 'gelungen';", "if (M.erfolg === 'angreifer_weg' && false) return 'gelungen';", 'Geleit: das Ende der Angreifer gilt nicht (Havarist)'],
  [SB, "if (M.erfolg === 'angreifer_weg' && !game.space.enemies.some((e) => e.tag === fs.tag)) return 'gelungen';", "if (!game.space.enemies.some((e) => e.tag === fs.tag)) return 'gelungen';", 'Geleit: das Ende der Angreifer genuegt in jedem Modus'],
  [SB, "if (dauer > W.geleit.max_s) return 'gescheitert';", "if (false) return 'gescheitert';", 'Geleit: keine Hoechstdauer'],
  // ---- Szenen: Aufraeumen
  [SB, "if (fs.phase !== 'kampf') return;", "", 'Konvoi: im Vorlauf raeumt das Aufraeumen einen fremden Konvoi ab'],
  [SB, "if (weg.some((e) => e.id === game.ship.target)) Zielsysteme.zielLoeschen(game);", "", 'Konvoi: das Ziel der Lerche bleibt auf einem verschwundenen Schiff'],
  [SB, "if (k && k.pods && k.pods.length) { const s = Fracht.state(game); s.draussen = s.draussen.filter((d) => !k.pods.includes(d.id)); }", "", 'Konvoi: die Beute am Boden bleibt liegen'],
  [SB, "    sp.konvoi = null;\n    return;", "    return;", 'Konvoi: der Konvoi bleibt im Raum (Zustand)'],
  [SB, "if (sp.escorts) sp.escorts = sp.escorts.filter((q) => q.tag !== fs.tag);", "", 'Geleit: der Schuetzling bleibt nach der Szene'],
  [SB, "if (sp.escortsGone) sp.escortsGone = sp.escortsGone.filter((q) => q.tag !== fs.tag);", "", 'Geleit: die Erinnerung an den Schuetzling bleibt'],
  [SB, "const ARTEN = ['konvoi', 'geleit'];", "const ARTEN = ['konvoi'];", 'Szene: geleit ist keine Szenenart'],
  // ---- faden-szene.js (die vier Stellen)
  [FS, "const b2 = SZB2.istArt(it.art) ? SZB2.plan(it, crewN(game), nachCrew) : null;", "const b2 = null;", 'faden-szene beginnen: keine Szenenart der B2 (kein Plan)'],
  [FS, "n, textKey: b2 ? b2.textKey : it.art, plan: b2 };", "n, textKey: it.art, plan: b2 };", 'faden-szene beginnen: der Text folgt der Art statt dem Modus'],
  [FS, "funk(game, fmt(T.vorwarnung[fs.textKey], vars));", "funk(game, fmt(T.vorwarnung[it.art], vars));", 'faden-szene: die Vorwarnung folgt der Art statt dem Modus'],
  [FS, "if (SZB2.istArt(fs.art)) { const a = SZB2.ausgang(game, fs); return a ? enden(game, fs, a, null) : null; }", "", 'faden-szene kampfTakt: die Ausgaenge der B2-Szenen werden nicht gelesen'],
  [FS, "if (SZB2.istArt(fs.art)) SZB2.aufraeumen(game, fs);", "", 'faden-szene aufraeumen: Konvoi und Schuetzling bleiben'],
  [FS, "T.gelungen[fs.textKey || fs.art] : T.gescheitert[fs.textKey || fs.art]", "T.gelungen[fs.art] : T.gescheitert[fs.textKey || fs.art]", 'faden-szene enden: der Erfolgstext folgt der Art statt dem Modus'],
  [FS, "T.gelungen[fs.textKey || fs.art] : T.gescheitert[fs.textKey || fs.art]", "T.gelungen[fs.textKey || fs.art] : T.gescheitert[fs.art]", 'faden-szene enden: der Text des Scheiterns folgt der Art statt dem Modus'],
  [FS, "{ beat: Object.assign({}, ctx.beat.parameter) }", "{ beat: {} }", 'faden-szene: die Wahl des Beats (Parameter) kommt nicht in die Warteschlange'],
  // ---- Baustein sabotage: Ziele und Lage
  [B2, "|| !W.quell_besitzer.includes(nd.besitzer)) continue;", ") continue;", 'Ziel: auch ein Posten eines anderen Besitzers (Piraten, Konkordat, Rom)'],
  [B2, "|| nd.crew === true", "", 'Ziel: auch ein Posten der Crew'],
  [B2, "!nd || !h || !nd.posten ||", "!nd || !h ||", 'Ziel: auch ein Hex ohne Posten'],
  [B2, "if (!(Array.isArray(h.quellen) && h.quellen.length) || h.hafen) continue;", "if (h.hafen) continue;", 'Ziel: auch ein Posten ohne Quelle (kein Versorgungsposten)'],
  [B2, "if (!(Array.isArray(h.quellen) && h.quellen.length) || h.hafen) continue;", "if (!(Array.isArray(h.quellen) && h.quellen.length)) continue;", 'Ziel: auch ein Hafen'],
  [B2, "if (Posten().sprengungGesperrt(game, hex)) continue;", "", 'Ziel: auch ein Hex in der Ruf-Sperre der Sim'],
  [B2, "const erreicht = B1().erreichbar(game, hierHex(game), W.erreichbar_max);", "const erreicht = B1().erreichbar(game, hierHex(game), 99);", 'Ziel: beliebig weit weg'],
  [B2, "try { return !!Ruf().rufErreicht(game, require('../../content/welt/posten-werte.json').werte.mindestrang.wert.angreifen); }", "try { return true; }", 'Lage: der Rang zum Angreifen wird nicht verlangt'],
  [B2, "return !!(s && Number.isFinite(s.t) && ws.tickZahl - s.t < W.pause_ticks);", "return !!(s && Number.isFinite(s.t) && ws.tickZahl - s.t <= W.pause_ticks);", 'Pause: einen Tick zu lang'],
  [B2, "return !!(s && Number.isFinite(s.t) && ws.tickZahl - s.t < W.pause_ticks);", "return !!(s && Number.isFinite(s.t) && ws.tickZahl - s.t < W.pause_ticks - 1);", 'Pause: einen Tick zu kurz'],
  [B2, "zahl(game) { return pauseNoch(game) || !darfAngreifen(game) ? 0 : ziele(game).length; },", "zahl(game) { return !darfAngreifen(game) ? 0 : ziele(game).length; },", 'Lage: die Zahl im Kontext kennt die Pause nicht'],
  [B2, "zahl(game) { return pauseNoch(game) || !darfAngreifen(game) ? 0 : ziele(game).length; },", "zahl(game) { return pauseNoch(game) ? 0 : ziele(game).length; },", 'Lage: die Zahl im Kontext kennt den Rang nicht'],
  [B2, "zahl(game) { return pauseNoch(game) || !darfAngreifen(game) ? 0 : ziele(game).length; },", "zahl(game) { return pauseNoch(game) || !darfAngreifen(game) ? 0 : Math.min(1, ziele(game).length) + 0 * 1; },", 'Lage: die Zahl im Kontext ist nie groesser als 1 (Anzahl der Ziele)'],
  [B2, "if (pauseNoch(game)) return 'SABOTAGE_PAUSE:", "if (false) return 'SABOTAGE_PAUSE:", 'Lage: beim Anbieten und Oeffnen gilt die Pause nicht'],
  [B2, "if (!darfAngreifen(game)) return 'LAGE_ZIEL_FEHLT: die Crew darf noch keinen Posten angreifen (Rang)';", "", 'Lage: beim Anbieten und Oeffnen gilt der Rang nicht'],
  [B2, "if (!ziele(game).length) return 'LAGE_ZIEL_FEHLT: im Moment", "if (false) return 'LAGE_ZIEL_FEHLT: im Moment", 'Lage: beim Anbieten und Oeffnen genuegt auch kein Ziel'],
  // ---- Baustein sabotage: Beginn
  [B2, "if (pauseNoch(game)) return ab('Pause nach dem letzten Sabotage-Auftrag', 'sabotage_pause');", "", 'Beginn: in der Pause beginnt ein zweiter Auftrag'],
  [B2, "const z = darfAngreifen(game) ? ziele(game) : [];", "const z = ziele(game);", 'Beginn: ohne den Rang beginnt der Auftrag'],
  [B2, "if (!z.length) return ab('kein Ziel', 'sabotage_kein_ziel');", "if (!z.length) return { laeuft: true };", 'Beginn: ohne Ziel laeuft der Beat trotzdem (kein Fallback)'],
  [B2, "const hex = z[Math.floor(r * z.length) % z.length].hex;", "const hex = z[0].hex;", 'Beginn: das Ziel kommt nicht aus dem eigenen Strom der Faeden'],
  [B2, "if (!sagen(game, nsc, fmt(T.sabotage_start, { name: nsc.name, ort: hexName(hex) }))) return { ausgang: 'gescheitert' };", "sagen(game, nsc, fmt(T.sabotage_start, { name: nsc.name, ort: hexName(hex) }));", 'Beginn: ohne Funk laeuft der Beat trotzdem'],
  [B2, "    faden.parameter.ort = hex;   // der Ort", "    // der Ort", 'Beginn: das Ziel steht nicht im Faden (geht beim Speichern verloren)'],
  [B2, "    F.sabotage = { t: ws.tickZahl, n: Math.min(1000000, ((F.sabotage && F.sabotage.n) || 0) + 1) };", "", 'Beginn: die Pause beginnt nicht'],
  [B2, "n: Math.min(1000000, ((F.sabotage && F.sabotage.n) || 0) + 1) };", "n: 1 };", 'Beginn: die Zahl der Sabotage-Beats zaehlt nicht mit'],
  [B2, "F.sabotage = { t: ws.tickZahl,", "F.sabotage = { t: 0,", 'Beginn: die Pause haelt nicht den Tick des Beginns'],
  // ---- Baustein sabotage: Takt
  [B2, "if (verloren(ws, hex, f.laufend.seit)) {", "if (false) {", 'Takt: der Verlust des Ziels an Rom gilt nicht als Erfolg'],
  [B2, "e.typ === 'posten_verloren' && e.ort === hex && e.durch === 'rom' && e.n > seit)", "e.typ === 'posten_verloren' && e.ort === hex && e.durch === 'rom' && e.n >= seit)", 'Takt: ein Ereignis aus dem Tick des Beginns zaehlt'],
  [B2, "e.typ === 'posten_verloren' && e.ort === hex && e.durch === 'rom' && e.n > seit)", "e.typ === 'posten_verloren' && e.durch === 'rom' && e.n > seit)", 'Takt: ein Verlust an einem anderen Hex zaehlt'],
  [B2, "e.typ === 'posten_verloren' && e.ort === hex && e.durch === 'rom' && e.n > seit)", "e.typ === 'posten_verloren' && e.ort === hex && e.n > seit)", 'Takt: ein Verlust an Piraten zaehlt'],
  [B2, "e.typ === 'posten_verloren' && e.ort === hex && e.durch === 'rom' && e.n > seit)", "e.ort === hex && e.durch === 'rom' && e.n > seit)", 'Takt: jedes Ereignis am Ziel zaehlt'],
  [B2, "return Number.isFinite(sp) && sp > seit;", "return Number.isFinite(sp) && sp >= seit;", 'Takt: eine Sprengung aus dem Tick des Beginns zaehlt (Stand)'],
  [B2, "return Number.isFinite(sp) && sp > seit;", "return false;", 'Takt: nach dem Laden zaehlt die Sprengung im Stand nicht'],
  [B2, "if (!(nd && nd.posten && W.quell_besitzer.includes(nd.besitzer))) {", "if (false) {", 'Takt: ein verschwundenes Ziel beendet den Beat nicht'],
  [B2, "if (!(nd && nd.posten && W.quell_besitzer.includes(nd.besitzer))) {", "if (!(nd && nd.posten)) {", 'Takt: ein uebernommener Posten (anderer Besitzer) gilt noch als Ziel'],
  [B2, "|| D.BEATS[beat.typ].baustein !== 'sabotage') return null;", ") return null;", 'Takt: der Beat jedes Fadens gilt als Sabotage'],
  // ---- Baustein sabotage: Stand
  [B2, "return Number.isInteger(t) && t >= 0 && Number.isInteger(n) && n >= 1 && n <= 1000000 ? { t, n } : null;", "return Number.isInteger(t) && Number.isInteger(n) && n >= 1 && n <= 1000000 ? { t, n } : null;", 'Stand: ein negativer Tick wird gelesen'],
  [B2, "return Number.isInteger(t) && t >= 0 && Number.isInteger(n) && n >= 1 && n <= 1000000 ? { t, n } : null;", "return Number.isFinite(t) && t >= 0 && Number.isInteger(n) && n >= 1 && n <= 1000000 ? { t, n } : null;", 'Stand: ein Tick mit Nachkommastellen wird gelesen'],
  [B2, "return Number.isInteger(t) && t >= 0 && Number.isInteger(n) && n >= 1 && n <= 1000000 ? { t, n } : null;", "return Number.isInteger(t) && t >= 0 && Number.isInteger(n) && n <= 1000000 ? { t, n } : null;", 'Stand: die Zahl 0 wird gelesen'],
  [B2, "return Number.isInteger(t) && t >= 0 && Number.isInteger(n) && n >= 1 && n <= 1000000 ? { t, n } : null;", "return Number.isInteger(t) && t >= 0 && Number.isInteger(n) && n >= 1 ? { t, n } : null;", 'Stand: eine Zahl ueber der Obergrenze wird gelesen'],
  // ---- katalogFehler
  [B2, "for (const [k, t] of Object.entries(T)) if (!ok(t)) g(", "for (const [k, t] of Object.entries(T)) if (false) g(", 'katalogFehler: Text mit fremdem Platzhalter'],
  [B2, "'sabotage_pause']) if (!has(T, k)) g(", "'sabotage_pause']) if (false) g(", 'katalogFehler: Pflichttext fehlt'],
  [B2, "if (!(W && Number.isInteger(W.erreichbar_max)", "if (false && !(W && Number.isInteger(W.erreichbar_max)", 'katalogFehler: unmoegliche Zahlen fuer sabotage'],
  [B2, "if (br.lage !== undefined && !(typeof br.lage === 'string' && has(LAGEN, br.lage))) g(", "if (false) g(", 'katalogFehler: braucht.lage ohne Bedingung'],
  [B2, "if (cat.frist !== undefined && !(Number.isInteger(cat.frist) && cat.frist >= 1 && cat.frist <= 60)) g(", "if (false) g(", 'katalogFehler: frist keine Zahl'],
  [B2, "if (!(K && alleCrew(K.anzahl) && Array.isArray(K.siegen)", "if (false && !(K && alleCrew(K.anzahl) && Array.isArray(K.siegen)", 'katalogFehler: Daten des Konvois unvollstaendig'],
  [B2, "if (K && K.eskorte && !['1', '2', '3'].every((k) => require('./konvoi.js').ESKORTEN.includes(K.eskorte[k]))) g(", "if (false) g(", 'katalogFehler: unbekannte Eskorte'],
  [B2, "if (K && !require('../../shared/config.js').fracht.arten.includes(K.ladung)) g(", "if (false) g(", 'katalogFehler: Ladung keine Ladungsart'],
  [B2, "if (!(G && G.modi && has(G.modi, G.modus_standard)", "if (false && !(G && G.modi && has(G.modi, G.modus_standard)", 'katalogFehler: Daten des Geleits unvollstaendig'],
  [B2, "if (!['angekommen', 'angreifer_weg', 'repariert'].includes(M.erfolg)) g(", "if (false) g(", 'katalogFehler: Erfolgsart unbekannt'],
  [B2, "if (!require('./escort.js').KINDS.includes(M.kind) || !require('./escort.js').VERHALTEN.includes(M.verhalten)) g(", "if (false) g(", 'katalogFehler: Schuetzling-Klasse oder Verhalten unbekannt'],
  [B2, "if (!alleCrew(M.angreifer)) g(", "if (false) g(", 'katalogFehler: Angreifer je Crew fehlen'],
  [B2, "if ((M.erfolg === 'angekommen') !== (M.verhalten === 'folgt_kurs')) g(", "if (false) g(", 'katalogFehler: Erfolg passt nicht zum Verhalten'],
  [B2, "if ((M.erfolg === 'repariert') !== (M.reparatur_s > 0)) g(", "if (false) g(", 'katalogFehler: Reparaturzeit passt nicht zum Erfolg'],
  [B2, "for (const k of schluessel) for (const bl of ['vorwarnung', 'gelungen', 'gescheitert']) if (!(", "for (const k of schluessel) for (const bl of ['vorwarnung', 'gelungen', 'gescheitert']) if (false && !(", 'katalogFehler: Text der Szene fehlt'],
  [B2, "else for (const w of erl.erlaubt) if (a === 'konvoi' ?", "else for (const w of erl.erlaubt) if (false && a === 'konvoi' ?", 'katalogFehler: erlaubter Parameterwert ohne Daten'],
  // ---- Pruefer: Lage
  [PR, "    if (g) return g;\n  }\n  return null;\n}\n\n// ---------- Abenteuer (SUND-04b A1)", "  }\n  return null;\n}\n\n// ---------- Abenteuer (SUND-04b A1)", 'Pruefer: die Lage wird gefragt, aber nie abgelehnt'],
  [PR, "const g = l ? l.fehler(game) : fehl('LAGE_UNBEKANNT'", "const g = l ? l.fehler(game) : undefined; void fehl('LAGE_UNBEKANNT'", 'Pruefer: eine unbekannte Lagen-Bedingung wird durchgelassen'],
  [PR, "pruefeNscVon, pruefeLage,", "pruefeNscVon,", 'Pruefer: pruefeLage wird nicht ausgefuehrt (nicht exportiert)'],
  // ---- faden.js
  [FA, "return c && Number.isInteger(c.frist) && c.frist >= 1 ? c.frist : W.beat_frist; }", "return W.beat_frist; }", 'Faden: die eigene Frist des Beats (Katalog frist) gilt nicht'],
  [FA, "f.laufend.n >= fristVon(f)) {", "f.laufend.n >= W.beat_frist) {", 'Faden: die Frist ablaufen lassen gilt fuer jeden Beat gleich'],
  [FA, "  if (lg) return abgelehnt(lg);\n  if (P.nscAlt(r.vorlage)", "  if (P.nscAlt(r.vorlage)", 'Faden: das Anbieten fragt die Lage nicht'],
  [FA, "  if (lg) return abgelehnt(lg);\n  const reg = D.registriereAbenteuer", "  const reg = D.registriereAbenteuer", 'Faden: das Oeffnen fragt die Lage nicht'],
  [FA, "return g || (b && b.typ === 'faden_oeffnen' ? P.pruefeLage(game, D.vorlage(b.vorlage)) : null);", "return g;", 'Faden: faden_oeffnen (Pruefen) fragt die Lage nicht'],
  [FA, "  if (!g && b.typ === 'faden_oeffnen') g = P.pruefeLage(game, D.vorlage(b.vorlage));", "", 'Faden: faden_oeffnen (Anwenden) fragt die Lage nicht'],
  [FA, "  if (sb) b.sabotage = sb;\n", "", 'Faden: die Pause steht nicht im Weltstand'],
  [FA, "  if (sb) F.sabotage = sb; else if (b.sabotage !== undefined) F.ladeFehler.push('sabotage: verworfen');", "  if (b.sabotage !== undefined) F.ladeFehler.push('sabotage: verworfen');", 'Faden: die Pause wird beim Laden nicht gelesen'],
  // ---- Verdrahtung
  [RE, "try { require('./faden-b2.js').update(game); }", "try { void 0; }", 'Takt: der Sabotage-Takt laeuft nicht'],
  [BS, "registriere('sabotage', B2.sabotage);", "", 'Bausteine: sabotage bleibt ein Platzhalter'],
  [BPF, "  out.push(...require('./faden-b2.js').katalogFehler().map((t) => fehl('BAUPLAN_KATALOG', t)));", "", 'Expander: die Daten der B2 gehen nicht in katalogFehler'],
  // ---- Prompt und Mock
  [AP, "br.lage ? `braucht die Lage ${br.lage} (Kontext faeden.lage.${br.lage} groesser 0)` : null].filter(Boolean);", "null].filter(Boolean);", 'Katalog: die Lage des Beats steht nicht beim Beat'],
  [AP, "  if (lagen.length) L.push(`Kontext faeden.lage:", "  if (false) L.push(`Kontext faeden.lage:", 'Katalog: faeden.lage wird nicht erklaert'],
  [AP, "if (l) lage[k] = l.zahl(game); }", "if (l) lage[k] = 0; }", 'Kontext: die Zahl der Lage ist immer 0'],
  [AP, "wiedersehen_nsc: wiedersehen, lage };", "wiedersehen_nsc: wiedersehen };", 'Kontext: faeden.lage fehlt'],
  [AM, " && (!lageKey(t) || (opt.lage && opt.lage[lageKey(t)] > 0) || opt.mit === t));", ");", 'Mock: plant eine Sabotage ohne Ziel'],
  [AM, "wiedersehenDa(k.faeden && k.faeden.wiedersehen_nsc), lage: k.faeden && k.faeden.lage }", "wiedersehenDa(k.faeden && k.faeden.wiedersehen_nsc), lage: { sabotage_ziel: 1 } }", 'Mock: der Kontext (faeden.lage) wird nicht gelesen'],
  [AM, "(opt.lage && opt.lage[lageKey(t)] > 0)", "(opt.lage && Object.keys(opt.lage).length)", 'Mock: eine Lage gilt, wenn irgendeine Zahl da ist (nicht ihre eigene)'],
  [SYS, "unter `faeden.lage` für diese Lage", "unter `faeden` für diese Lage", 'Systemprompt: faeden.lage wird nicht erklaert'],
  // ---- Daten
  [DB, "\"frist\": 12,", "\"frist\": 6,", 'Daten: sabotage hat die allgemeine Frist'],
  [DB, ", \"lage\": \"sabotage_ziel\"}", "}", 'Daten: sabotage haengt nicht von der Lage ab'],
  [DB, "\"erlaubt\":[\"aufhalten\",\"pluendern\"]", "\"erlaubt\":[\"aufhalten\"]", 'Daten: der Plan darf nicht pluendern'],
  [DB, "\"erlaubt\":[\"geleit\",\"havarist\",\"panne\"]", "\"erlaubt\":[\"geleit\"]", 'Daten: der Plan darf nur das Geleit'],
  [DB, "\"baustein\": \"konvoi\",\n      \"gefahr\": true,", "\"baustein\": \"konvoi\",\n      \"gefahr\": false,", 'Daten: der Konvoi bringt keine Gefahr (Optionen wuerden erlaubt)'],
  [DB, "\"baustein\": \"geleit\",\n      \"gefahr\": true,\n      \"optionen\": \"keine\",\n      \"szene\": true,", "\"baustein\": \"geleit\",\n      \"gefahr\": true,\n      \"optionen\": \"keine\",", 'Daten: das Geleit ist keine Szene (ein laufender Beat wird gespeichert)'],
  [DB, "\"baustein\": \"konvoi\",\n      \"gefahr\": true,\n      \"optionen\": \"keine\",\n      \"szene\": true,", "\"baustein\": \"konvoi\",\n      \"gefahr\": true,\n      \"optionen\": \"keine\",", 'Daten: der Konvoi ist keine Szene (ein laufender Beat wird gespeichert)'],
  [DB, "\"baustein\": \"sabotage\",\n      \"gefahr\": false,\n      \"optionen\": \"keine\",", "\"baustein\": \"sabotage\",\n      \"gefahr\": false,\n      \"optionen\": \"keine\",\n      \"szene\": true,", 'Daten: sabotage ist eine Szene (ein laufender Beat wird beim Laden zurueckgesetzt)'],
  [DB, "{\"typ\":\"haltung_aenderung\",\"grund\":\"gedankt\"}]},\"gescheitert\":{\"status\":[\"aktiv\",\"geflohen\"],\"folge\":[]}}}\n    },\n    \"abschluss\"", "{\"typ\":\"haltung_aenderung\",\"grund\":\"gedankt\"}]},\"gescheitert\":{\"status\":[\"verbuendet\"],\"folge\":[]}}}\n    },\n    \"abschluss\"", 'Daten: das Scheitern der Sabotage laesst den NSC verbuendet'],
  [DS, "\"anzahl\": {\"1\": 1, \"2\": 2, \"3\": 2}", "\"anzahl\": {\"1\": 2, \"2\": 2, \"3\": 2}", 'Daten: eine Crew bekommt zwei Transporter'],
  [DS, "\"ladung\": \"fracht\"", "\"ladung\": \"sprengstoff\"", 'Daten: die Beute ist der Sprengstoff'],
  [DS, "\"volk\": \"ger\", \"max_s\": 300}", "\"volk\": \"rom\", \"max_s\": 300}", 'Daten: der Konvoi ist roemisch'],
  [DS, "\"max_s\": 300}", "\"max_s\": 1}", 'Daten: der Konvoi hat fast keine Zeit'],
  [DS, "\"angreifer\": {\"1\": 2, \"2\": 2, \"3\": 3}", "\"angreifer\": {\"1\": 3, \"2\": 2, \"3\": 3}", 'Daten: eine Crew bekommt drei Angreifer beim Geleit'],
  [DS, "\"verhalten\": \"treibt\", \"huelle\": 70, \"reparatur_s\": 20", "\"verhalten\": \"treibt\", \"huelle\": 70, \"reparatur_s\": 40", 'Daten: die Panne dauert 40 s'],
  [DS, "\"ziele\": [\"west\", \"ost\"]", "\"ziele\": [\"ost\"]", 'Daten: das Geleit hat nur eine Zielseite'],
  [DS, "\"konvoi\": \"Ein germanischer Konvoi mit Eskorte zieht in {sek} Sekunden durch den Sektor. Haltet ihn auf!\"", "\"konvoi\": \"Ein germanischer Konvoi mit Eskorte zieht durch den Sektor. Haltet ihn auf!\"", 'Daten: die Vorwarnung nennt die Sekunden nicht'],
  [DT, "\"pause_ticks\": 80", "\"pause_ticks\": 1", 'Daten: die Pause ist einen Tick lang'],
  [DT, "\"erreichbar_max\": 6", "\"erreichbar_max\": 1", 'Daten: das Ziel liegt hoechstens einen Sprung weit'],
  [DT, "\"quell_besitzer\": [\"ger\"]", "\"quell_besitzer\": [\"ger\", \"pirat\"]", 'Daten: auch ein Piratenposten ist ein Ziel'],
  // ---- Katalog (Moleküle)
  [KM, "if (u.schauplatz !== 'weltraum') out.push(", "if (false) out.push(", 'Katalog: sund_frei auch fuer eine Boden-Umsetzung'],
  [KM, "if (!has(faedenBeats, s.beat)) {", "if (false) {", 'Katalog: sund_frei nennt einen Beat, den es nicht gibt'],
  [KM, "const p = has(bp.parameter || {}, k) ? bp.parameter[k] : null;", "const p = (bp.parameter || {})[k] || { erlaubt: [v] };", 'Katalog: sund_frei nennt einen Parameter, den der Beat nicht kennt'],
  [KM, "else if (!p.erlaubt.includes(v)) out.push(", "else if (false) out.push(", 'Katalog: sund_frei nennt einen Wert ausserhalb der erlaubten Liste'],
  [KM, "if (u.sund_frei) for (const t of sundFreiFehler(u))", "if (false) for (const t of sundFreiFehler(u))", 'Katalog: der Querverweis sund_frei wird beim Laden nicht geprueft'],
  [KS, "\"additionalProperties\": false,\n          \"required\": [\"beat\", \"belegt\"],", "\"additionalProperties\": true,\n          \"required\": [\"beat\", \"belegt\"],", 'Schema: sund_frei nimmt beliebige Felder'],
  [KS, "\"required\": [\"beat\", \"belegt\"],", "\"required\": [\"beat\"],", 'Schema: sund_frei braucht keinen Beleg'],
  [KS, "\"minLength\": 8, \"maxLength\": 200", "\"minLength\": 0, \"maxLength\": 200", 'Schema: ein leerer Beleg'],
  [MK, "\"parameter\": { \"sieg\": \"pluendern\" }", "\"parameter\": { \"sieg\": \"aufhalten\" }", 'Moleküle: Konvoi plündern spielt den Sieg aufhalten'],
  [MK, "\"parameter\": { \"sieg\": \"aufhalten\" }", "\"parameter\": { \"sieg\": \"pluendern\" }", 'Moleküle: Konvoi aufhalten spielt die Plünderung'],
  [MS, "\"parameter\": { \"modus\": \"havarist\" }", "\"parameter\": { \"modus\": \"geleit\" }", 'Moleküle: Notruf verteidigen spielt das Geleit'],
  [MS, "\"parameter\": { \"modus\": \"geleit\" }", "\"parameter\": { \"modus\": \"havarist\" }", 'Moleküle: Geleit durch einen Angriff spielt den Havaristen'],
  [MP, "\"parameter\": { \"modus\": \"panne\" }", "\"parameter\": { \"modus\": \"geleit\" }", 'Moleküle: Pannenhilfe spielt das Geleit'],
  [SCH, "\"sabotage\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"t\",\"n\"]", "\"sabotage\":{\"type\":\"object\",\"additionalProperties\":true,\"required\":[\"t\",\"n\"]", 'Schema: der Block sabotage nimmt beliebige Felder'],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-faden-katalog-b2.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
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
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
