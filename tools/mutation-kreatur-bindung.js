'use strict';
// MON-01 P3: Mutationsprobe zu tools/test-kreatur-bindung.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle
// im Baustein `bindung` oder seiner Anbindung und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-kreatur-bindung.js [begriff …] [--trocken]      (npm run test:kreatur-bindung-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-kreatur-bindung-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-kreatur-bindung.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const KR = 'server/sim/kreatur.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Kopplungsabfrage (Anker)
  [KR, "  for (const t of B.eintritt) if (t == null || (f > 0 && game.time - t > f)) return false;\n  return true;", "  for (const t of B.eintritt) if (t == null) return false;\n  return true;", 'bindung: Zeitfenster wird ignoriert'],
  [KR, "  for (const t of B.eintritt) if (t == null || (f > 0 && game.time - t > f)) return false;\n  return true;", "  return B.eintritt.some((t) => t != null && !(f > 0 && game.time - t > f));", 'bindung: ein Anker im Zustand genügt (statt alle)'],
  [KR, "  for (const t of B.eintritt) if (t == null || (f > 0 && game.time - t > f)) return false;\n  return true;", "  for (const t of B.eintritt) if (t == null || (f > 0 && t > f)) return false;\n  return true;", 'bindung: Alter des Eintritts wird gegen die absolute Zeit statt gegen die Spielzeit verglichen'],
  [KR, "    const drin = Ank.zustand(game, B.map, B.ids[i]) === zustand;", "    const drin = Ank.zustand(game, B.map, B.ids[i]) != null;", 'bindung: Zielzustand wird nicht geprüft (jeder Zustand zählt)'],
  [KR, "    else if (B.eintritt[i] == null) B.eintritt[i] = erstmals ? -Infinity : game.time;", "    else B.eintritt[i] = erstmals ? -Infinity : game.time;", 'bindung: Eintritt wird nicht gemerkt (jeder Tick ist ein neuer Eintritt)'],
  [KR, "    if (!drin) B.eintritt[i] = null;\n", "    if (!drin) { /* Verlassen wird nicht gemerkt */ }\n", 'bindung: Verlassen des Zustands wird nicht gemerkt'],
  [KR, "B.eintritt[i] = erstmals ? -Infinity : game.time;", "B.eintritt[i] = game.time;", 'bindung: Anker, die beim Anlegen schon im Zustand sind, zählen als frischer Eintritt'],
  [KR, "      B.loesT = par.folge.verzoegerung || 0;", "      B.loesT = 0;", 'bindung: Verzögerung der Folge wird ignoriert'],
  [KR, "    } else B.loesT -= dt;", "    } else B.loesT -= 0;", 'bindung: Verzögerung läuft nie ab'],
  [KR, "      else { bindungBeobachten(game, B, par.bedingung.zustand, false); geloest = bindungGeloest(game, B, par.bedingung); }", "      else { geloest = bindungGeloest(game, B, par.bedingung); }", 'bindung: Anker werden im Tick nicht beobachtet'],
  // ---- Kreatur-Quelle
  [KR, "      if (B.art === 'kreatur') geloest = !quelleLebt(game.away, K, par.quelle);", "      if (B.art === 'kreatur') geloest = false;", 'bindung: Königin-Prüfung entfernt (löst nie auf)'],
  [KR, "      if (B.art === 'kreatur') geloest = !quelleLebt(game.away, K, par.quelle);", "      if (B.art === 'kreatur') geloest = true;", 'bindung: Königin-Prüfung entfernt (löst sofort auf)'],
  [KR, "o !== K && o.alive && (q.id", "o !== K && (q.id", 'bindung: tote Kreatur zählt als lebende Quelle'],
  [KR, "(q.id ? o.id === q.id : o.typ === q.typ)", "(o.typ === q.typ)", 'bindung: Quelle per ID wird wie Quelle per Typ behandelt'],
  [KR, "(q.id ? o.id === q.id : o.typ === q.typ)", "(q.id ? o.typ === q.typ : o.typ === q.typ)", 'bindung: Quelle per ID vergleicht den Typ'],
  [KR, "o !== K && o.alive", "o.alive", 'bindung: die gebundene Kreatur zählt sich selbst als Quelle'],
  // ---- Folge aufloesen
  [KR, "  game.emit('kreaturAufgeloest', d);\n", "", 'aufloesen: Ereignis kreaturAufgeloest fehlt'],
  [KR, "  game.missionEvent('kreaturAufgeloest', d);\n", "", 'aufloesen: Missionsereignis kreaturAufgeloest fehlt'],
  [KR, "  game.missionEvent('kreaturAufgeloest', d);\n}", "  game.missionEvent('kreaturAufgeloest', d);\n  game.missionEvent('droneKilled', { kind: K.typ });\n}", 'aufloesen: meldet zusätzlich droneKilled'],
  [KR, "  game.missionEvent('kreaturAufgeloest', d);\n}", "  game.missionEvent('kreaturAufgeloest', d);\n  game.emit('enemyDown', { id: K.id });\n}", 'aufloesen: meldet zusätzlich enemyDown (Fall)'],
  [KR, "  if (entfernen) {", "  if (false) {", 'update: aufgelöste Kreaturen werden nicht aus aw.kreaturen entfernt'],
  [KR, "if (!L[i].weg) L[w++] = L[i];", "if (L[i].alive && !L[i].weg) L[w++] = L[i];", 'update: entfernt die toten statt der aufgelösten Kreaturen (die tote Königin verschwindet)'],
  [KR, "    if (K.weg) { entfernen = true; continue; }\n", "    if (K.weg) entfernen = true;\n", 'update: aufgelöste Kreatur wird im selben Tick noch weitergetickt', true],
  [KR, "  if (K.weg) return;\n  K.weg = true;\n", "  K.weg = true;\n", 'aufloesen: Doppelschutz entfällt (nicht beobachtbar: der Abgleich ruft nach K.weg nicht mehr)', true],
  // ---- Anbindung im Tick
  [KR, "    if (K.alive) bausteinAbgleich(game, K, dt);   // P3: Bindungen auch bei Betäubung und Stillstand\n", "    bausteinAbgleich(game, K, dt);\n", 'update: Abgleich auch für tote Kreaturen'],
  [KR, "    if (K.alive) bausteinAbgleich(game, K, dt);   // P3: Bindungen auch bei Betäubung und Stillstand\n", "    if (K.alive && k) bausteinAbgleich(game, K, dt);\n", 'update: Abgleich nur mit Außenteam am Boden'],
  [KR, "    if (K.alive) bausteinAbgleich(game, K, dt);   // P3: Bindungen auch bei Betäubung und Stillstand\n", "    if (K.alive && (!Wf || Wf.handlungsfaehig(game, K))) bausteinAbgleich(game, K, dt);\n", 'update: Abgleich nur für handlungsfähige Kreaturen (betäubt bleibt gebunden)'],
  [KR, "def.beiAbgleich(game, K, dt, typ.bausteine[b]); } }", "void 0; } }", 'bausteinAbgleich ruft den Hook beiAbgleich nicht'],
  [KR, "def && def.beiErzeugen) def.beiErzeugen(game, K, typ.bausteine[b]);", "def && def.beiErzeugen) void 0;", 'erzeugen: ruft den Hook beiErzeugen nicht (Bindung wird nie angelegt)'],
  [KR, "catch (e) { aw.kreaturSeq--; throw e; }", "catch (e) { throw e; }", 'erzeugen: Nummernzähler nach fehlgeschlagenem Anlegen nicht zurückgesetzt'],
  [KR, "  catch (e) { aw.kreaturSeq--; throw e; }", "  catch (e) { aw.kreaturSeq--; }", 'erzeugen: Fehler des Bausteins wird verschluckt (halbe Kreatur)'],
  // ---- Quelle lesen
  [KR, "    if (!a) throw new Error('bindung: Anker '", "    if (!a) continue; throw new Error('bindung: Anker '", 'bindung: nicht vorhandene Anker-ID wird still ignoriert'],
  [KR, "k.anker.filter((a) => a.rolle === q.rolle).map((a) => a.id)", "k.anker.filter((a) => a.rolle === q.rolle).slice(0, 1).map((a) => a.id)", 'bindung: Rolle bindet nur den ersten Anker'],
  [KR, "  if (!ids.length) throw new Error(", "  if (!ids.length && false) throw new Error(", 'bindung: Rolle ohne Anker auf der Karte wird nicht gemeldet'],
  [KR, "    if (!erlaubt.includes(par.bedingung.zustand)) throw new Error(", "    if (false) throw new Error(", 'bindung: Zustand, den die Rolle nicht kennt, wird nicht gemeldet'],
  [KR, "  if (!k || !Array.isArray(k.anker)) throw new Error(", "  if (!k || !Array.isArray(k.anker)) return [];\n  if (false) throw new Error(", 'bindung: Karte ohne Anker wird nicht gemeldet'],
  [KR, "      if (!quelleLebt(aw, K, q)) throw new Error(", "      if (false) throw new Error(", 'bindung: fehlende Kreatur-Quelle beim Anlegen wird nicht gemeldet'],
  // ---- Schreiben in Anker (muss rot werden)
  [KR, "  K.weg = true;\n", "  K.weg = true;\n  if (K.bindung && K.bindung.ids) game.away.zustaende[K.bindung.ids[0]] = 'voll';\n", 'bindung: schreibt beim Auflösen in den Anker-Zustand'],
  [KR, "    const drin = Ank.zustand(game, B.map, B.ids[i]) === zustand;", "    const drin = Ank.zustand(game, B.map, B.ids[i]) === zustand; if (!game.away.zustaende[B.ids[i]]) game.away.zustaende[B.ids[i]] = Ank.zustand(game, B.map, B.ids[i]);", 'bindung: schreibt beim Beobachten den Anker-Zustand in aw.zustaende'],
  [KR, "    K.bindung = { art: 'anker', map: aw.map, ids, eintritt: ids.map(() => null), loesT: null };", "    K.bindung = { art: 'anker', map: aw.map, ids, eintritt: ids.map(() => null), loesT: null };\n    (aw.ankerLauf || (aw.ankerLauf = {})).bindung = ids;", 'bindung: schreibt in aw.ankerLauf'],
  // ---- Validator
  [KR, " || new Set(q.ids).size !== q.ids.length)) F.push(", ")) F.push(", 'validator: doppelte Anker-IDs werden nicht abgelehnt'],
  [KR, "      if ((q.ids === undefined) === (q.rolle === undefined)) F.push(", "      if (false) F.push(", 'validator: ids und rolle zugleich bzw. keines von beiden wird nicht abgelehnt'],
  [KR, "      else if (q.rolle !== undefined && !ankerRollen()[q.rolle]) F.push(", "      else if (false) F.push(", 'validator: unbekannte Anker-Rolle wird nicht abgelehnt'],
  [KR, "!KREATUREN.typen[q.typ])) F.push(", "false)) F.push(", 'validator: unbekannter Kreaturentyp als Quelle wird nicht abgelehnt'],
  [KR, "!(typeof q.id === 'string' && /^K\\d+$/.test(q.id))) F.push(", "false) F.push(", 'validator: ungültige Kreatur-ID als Quelle wird nicht abgelehnt'],
  [KR, "      if ((q.typ === undefined) === (q.id === undefined)) F.push(", "      if (false) F.push(", 'validator: Typ und ID zugleich wird nicht abgelehnt'],
  [KR, "      if (!b || typeof b !== 'object' || Array.isArray(b)) F.push('bedingung: { zustand, fenster? } erwartet (Anker-Quelle)');", "      if (false) F.push('bedingung: { zustand, fenster? } erwartet (Anker-Quelle)');\n      else if (!b) { /* */ }", 'validator: Anker-Quelle ohne Bedingung wird nicht abgelehnt'],
  [KR, "if (b.fenster !== undefined && !zahl(b.fenster, 0)) F.push(", "if (false) F.push(", 'validator: ungültiges Fenster wird nicht abgelehnt'],
  [KR, "else if (b !== undefined && q && q.art === 'kreatur') F.push(", "else if (false) F.push(", 'validator: Bedingung bei Kreatur-Quelle wird nicht abgelehnt'],
  [KR, "      if (f.art !== 'aufloesen') F.push(", "      if (false) F.push(", 'validator: andere Folge als aufloesen wird nicht abgelehnt'],
  [KR, "      if (f.verzoegerung !== undefined && !zahl(f.verzoegerung, 0)) F.push(", "      if (false) F.push(", 'validator: negative Verzögerung wird nicht abgelehnt'],
  [KR, "    if (!f || typeof f !== 'object' || Array.isArray(f)) F.push('folge:", "    if (!f) { /* fehlende Folge erlaubt */ } else if (typeof f !== 'object' || Array.isArray(f)) F.push('folge:", 'validator: fehlende Folge wird nicht abgelehnt'],
  [KR, "    for (const k of Object.keys(par)) if (!BINDUNG_FELDER.includes(k)) F.push(", "    for (const k of Object.keys(par)) if (false) F.push(", 'validator: unbekannte Felder werden nicht abgelehnt'],
  [KR, "else if (q.rolle !== undefined && ankerRollen()[q.rolle] && !(ankerRollen()[q.rolle].zustaende || []).includes(b.zustand)) F.push(", "else if (false) F.push(", 'validator: Zustand, den die Rolle nicht kennt, wird nicht abgelehnt'],
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
console.log(`Mutationsprobe test-kreatur-bindung.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
