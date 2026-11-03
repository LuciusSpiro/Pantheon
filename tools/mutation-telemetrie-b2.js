'use strict';
// TEL-01 B2 Nacharbeit: Mutationsprobe zu den Telemetrie-Tests von Paket B2 (test-telemetrie-b2, test-telemetrie-deckung, test-telemetrie-spielleiter, test-telemetrie-server).
// Kopiert server/, shared/, content/ und tools/ in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Stelle und verlangt, dass der genannte Test rot wird
// (Exit 1 MIT FEHLER-Zeile; ein Absturz oder Syntaxfehler zaehlt nicht als erkannt). Jeder Anker muss genau einmal im Quelltext stehen (sonst Exit 2). --trocken prueft nur die Anker.
// Mutationen mit `aequivalent: true` sind nachweislich gleichwertig zum Original (keine Beobachtung moeglich) und MUESSEN ueberleben; so bleibt die Begruendung im Code stehen.
//   node tools/mutation-telemetrie-b2.js [--trocken] [begriff ...]      (npm test haengt es ein; npm run test:telemetrie-b2-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const T0 = Date.now();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-tel-b2-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content', 'tools']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* nicht noetig */ } } }

const HK = 'server/telemetrie/haken.js', HI = 'server/telemetrie/hilfen.js', CB = 'server/sim/combat.js', IX = 'server/index.js', GM = 'server/game.js', VO = 'server/sim/vorrat.js', RF = 'server/sim/ruf.js';
const LSL = 'server/sim/lage-spielleiter.js', ASL = 'server/sim/abenteuer-spielleiter.js', KSL = 'server/mission/spielleiter.js';
const T_B2 = 'test-telemetrie-b2.js', T_DK = 'test-telemetrie-deckung.js', T_SL = 'test-telemetrie-spielleiter.js', T_SV = 'test-telemetrie-server.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Test, Optionen]
const MUTATIONEN = [
  // --- Deckung (Rohzustand) ---
  [HK, "      if (p.zone !== 'away') { const rec = s.deck.get(p.id); if (rec) deckungSchliessen(game, s, rec, 'ort'); continue; }\n", '', "Deckung der Spieler ohne die Pruefung p.zone === 'away' (kein Schliessen mit ende ort)", T_DK],
  [HK, "const draussen = k.zone === 'away';", 'const draussen = true;', "deckungsZustand ohne p.zone === 'away' (an Bord zaehlt crouch/cv)", T_DK],
  [HK, "const ortWechsel = s.away !== aw;", 'const ortWechsel = false;', 'Ortswechsel der Aussenkarte schliesst nichts', T_DK],
  [HK, "    if (!rec.k.alive) deckungSchliessen(game, s, rec, 'tod');", '', 'gefallener Gegner schliesst seinen Deckungszustand nicht', T_DK],
  [HK, "    else if (takt && (!aw || !aw.drones || aw.drones.indexOf(rec.k) < 0)) deckungSchliessen(game, s, rec, 'weg');", '', 'entfernter Gegner schliesst seinen Deckungszustand nicht', T_DK],
  [HK, "    t.beiAbschluss(() => { for (const rec of [...s.deck.values()]) deckungSchliessen(game, s, rec, 'session'); });", '', 'Sessionende schliesst offene Deckungszustaende nicht', T_DK],
  [HK, "const t = (z.geduckt ? 1 : 0) + '|' + (z.stellung ? 1 : 0);", "const t = (z.geduckt ? 1 : 0) + '|0';", 'Stellung ist nicht Teil des Gegner-Tupels', T_DK],
  [HK, "game.tick % TAKT !== 0) return;", "false) return;", 'Gegner: die Stellung wird jeden Tick statt im 5-Hz-Takt geprueft (Kosten; der Test haelt den Takt fest)', T_DK],
  [HK, "    else if (takt && (!aw ||", "    else if ((!aw ||", 'Gegner aus der Liste: Pruefung jeden Tick statt im Takt (nur die Kosten aendern sich)', T_DK, { aequivalent: true }],
  [HK, "const t = z.cv + '|' + (z.geduckt ? 1 : 0) + '|' + (z.verdeckt ? 1 : 0);", "const t = z.cv + '|' + (z.geduckt ? 1 : 0);", 'verdeckt ist nicht Teil des Spieler-Tupels', T_DK],
  [CB, '  return alarmiert;\n}', '  return true;\n}', 'verdecktVor ohne alarmierte Gegner trotzdem true', T_DK],
  [HI, 'const kachel = (v) => Math.floor(v / TILE);', 'const kachel = (v) => Math.round(v / TILE);', 'Positionen mit Math.round statt Math.floor (Physics.toTile)', T_DK],
  // --- Technik: Tickzeit, Zeitreihe, Eingaben ---
  [HK, "    if (lief) {\n      const ms = performance.now() - t0;", "    if (true) {\n      const ms = performance.now() - t0;", 'Tickzeit der Solo-Pause wird mitgezaehlt (lief ignoriert)', T_B2],
  [HK, 'if (lief && game.time + EPS >= s.naechst) {', 'if (game.time + EPS >= s.naechst) {', 'Zeitreihe ohne lief (in der Pause steht game.time still und jede Zeile rueckt naechst ueber game.time: nicht beobachtbar)', T_B2, { aequivalent: true }],
  [HK, "      s.naechst += FENSTER; if (s.naechst <= game.time) s.naechst = game.time + FENSTER;   // zuerst weiterschieben: ein Fehler in zeile() soll sich nicht jeden Tick wiederholen\n      zeile(game, s);",
    "      zeile(game, s);\n      s.naechst += FENSTER; if (s.naechst <= game.time) s.naechst = game.time + FENSTER;", 'Fenster rueckt erst nach zeile() weiter: ein Fehler wiederholt sich jeden Tick', T_B2],
  [GM, "      if (msg.t !== C.DEBUG && msg.t !== 'clientError') Haken.eingabe(", '      Haken.eingabe(', 'Debug und clientError zaehlen als Eingabe', T_B2],
  [GM, "      if (msg.t !== C.DEBUG && msg.t !== 'clientError') Haken.eingabe(", "      if (msg.t !== 'clientError') Haken.eingabe(", 'Debug zaehlt als Eingabe', T_B2],
  [GM, "      if (msg.t !== C.DEBUG && msg.t !== 'clientError') Haken.eingabe(", "      if (msg.t !== C.DEBUG) Haken.eingabe(", 'clientError zaehlt als Eingabe', T_B2],
  [IX, 'if (game.telemetrie.offen) Haken.tickKappung(game, acc - 250); ', '', 'Tickschleife meldet die Kappung nicht', T_SV],
  [IX, '        if (s0) Haken.snapshotZeit(game, performance.now() - s0);\n', '', 'Tickschleife meldet die Snapshot-Zeit nicht', T_SV],
  [IX, '      if (game.telemetrie.offen && ++nachgeholt > 1) Haken.nachgeholt(game, 1);', '', 'Tickschleife meldet nachgeholte Ticks nicht', T_SV],
  // --- Spielleiter-Haken an ihren echten Stellen ---
  [HK, "e.code === 'ETIMEDOUT' ? 'timeout' : 'fehler'", "'fehler'", 'ETIMEDOUT wird als fehler gemeldet', T_SL],
  [LSL, "      Haken.spielleiterWarten(this.game, 'lage', this.game.time - job.start, Haken.warteAusgang(it.e));", '', 'Lage-Spielleiter: Antwort abholen ohne Haken', T_SL],
  [LSL, "      Haken.spielleiterWarten(this.game, 'lage', this.game.time - job.start, 'timeout');", '', 'Lage-Spielleiter: Frist ohne Haken', T_SL],
  [ASL, "      Haken.spielleiterWarten(this.game, 'abenteuer', this.game.time - job.start, Haken.warteAusgang(it.e));", '', 'Abenteuer-Spielleiter: Antwort abholen ohne Haken', T_SL],
  [ASL, "      Haken.spielleiterWarten(this.game, 'abenteuer', this.game.time - job.start, 'timeout');", '', 'Abenteuer-Spielleiter: Frist ohne Haken', T_SL],
  [KSL, "    Haken.spielleiterWarten(this.game, String(job.type), dauer, Haken.warteAusgang(e));", '', 'Kampagnen-Spielleiter: finishJob ohne Haken', T_SL],
  [KSL, "    Haken.spielleiterWarten(this.game, 'anflug', sec, how);", '', 'Kampagnen-Spielleiter: Anflug-Wartezeit ohne Haken', T_SL],
  // --- Wirtschaft, Reparatur, Energie ---
  [HI, 'const num = (v) => (Number.isFinite(v) ? r2(v) : null);', 'const num = (v) => (Number.isFinite(v) ? r2(v) : 0);', 'kaputter Wert wird 0 statt null', T_B2],
  [VO, 'Haken.buchung(game, gut, art, grund, neu - vorher, neu);', 'Haken.buchung(game, gut, art, grund, neu - (Number(vorher) || 0), neu);', 'vorrat: kaputter Vorwert wird 0', T_B2],
  [RF, 'Haken.ruf(game, fraktion, ws.ruf[fraktion] - alt, ws.ruf[fraktion], grund);', 'Haken.ruf(game, fraktion, ws.ruf[fraktion] - alt, ws.ruf[fraktion], null);', 'ruf ohne grund', T_B2],
  [HK, 'sektor = sektorName(z);', 'sektor = null;', 'zone_wieder ohne Sektor', T_B2],
  [HK, "if (grund === 'automatik' && (erst || gleich)) return;", "if (grund === 'automatik' && erst) return;", 'energie automatik schreibt auch ohne Aenderung', T_B2],
];

const trocken = process.argv.includes('--trocken');
const filter = process.argv.slice(2).filter((a) => a !== '--trocken');
const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), 'utf8').replace(/\r\n/g, '\n');   // Windows-Checkout mit CRLF: Muster mit \n sollen treffen
let fehlAnker = 0;
for (const [datei, alt, , was] of MUTATIONEN) { const n = lies(datei).split(alt).length - 1; if (n !== 1) { console.log('ANKER ' + n + 'x: ' + was); fehlAnker++; } }
if (fehlAnker) process.exit(2);
if (trocken) { console.log(MUTATIONEN.length + ' Anker, alle genau einmal'); process.exit(0); }

const lauf = (test) => spawnSync(process.execPath, [path.join(TMP, 'tools', test)], { cwd: TMP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
const basis = {};
for (const test of new Set(MUTATIONEN.filter((m) => !filter.length || filter.some((f) => m[3].includes(f))).map((m) => m[4]))) {
  const r = lauf(test);
  if (r.status !== 0) { console.log('Ausgangslage ist schon rot (' + test + '):\n' + (r.stdout || '') + (r.stderr || '')); process.exit(1); }
  basis[test] = true;
}
let ueberlebt = 0, laeufe = 0;
for (const [datei, alt, neu, was, test, opt] of MUTATIONEN) {
  if (filter.length && !filter.some((f) => was.includes(f))) continue;
  const o = opt || {};
  const pfad = path.join(TMP, datei), orig = lies(datei);
  fs.writeFileSync(pfad, orig.split(alt).join(neu));
  const r = lauf(test);
  fs.writeFileSync(pfad, orig);
  laeufe++;
  const out = (r.stdout || '') + (r.stderr || '');
  const rot = r.status === 1 && /FEHLER/.test(r.stdout || '') && !/SyntaxError/.test(out);   // ein Syntaxfehler der Mutation toetet nichts
  if (o.aequivalent) {
    if (r.status === 0) console.log('gleichwertig (ueberlebt wie erwartet): ' + was);
    else { ueberlebt++; console.log('GLEICHWERTIG NICHT MEHR (der Test wird rot: Anker pruefen, Eintrag aequivalent entfernen): ' + was); }
    continue;
  }
  if (rot) console.log('getoetet:  ' + was + '  [' + test + ']');
  else { ueberlebt++; console.log((r.status === 0 ? 'UEBERLEBT: ' : 'ABSTURZ (zaehlt nicht): ') + was + '  [' + test + ']'); }
}
console.log(`${laeufe} Mutationen, ${ueberlebt} ueberlebt, ${Math.round((Date.now() - T0) / 100) / 10} s`);
process.exit(ueberlebt ? 1 : 0);
