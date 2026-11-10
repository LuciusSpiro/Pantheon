#!/usr/bin/env node
'use strict';
// DYN-01 B: Mutationsprobe zu tools/test-abenteuer-landeplaetze.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Stelle
// (je Pruefregel, je Haken, Eignung, Idempotenz, Daten, Prompt) und verlangt, dass der Test rot wird (Exit != 0 UND eine ✗-Zeile; ein Absturz zaehlt nicht als erkannt). Ueberlebt eine Mutation, deckt der Test die Stelle nicht ab.
// Selbstcheck: VOR jedem Lauf muss jeder Anker genau einmal in der Kopie stehen, sonst Exit 2 (statt eine Mutation still zu ueberspringen).
//   node tools/mutation-abenteuer-landeplaetze.js [begriff ...] [--trocken]      (npm run test:abenteuer-landeplaetze-mutation)
// Keine node_modules-Junction (nie loeschen, was woanders liegt): NODE_PATH zeigt auf die des Repos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-landeplaetze-'));
const loesche = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } };
for (const d of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });   // der Server liest karte-tokens.js
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const t of ['test-abenteuer-landeplaetze.js', 'regie-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', t), path.join(TMP, 'tools', t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
const TEST = 'tools/test-abenteuer-landeplaetze.js';

const AO = 'server/sim/abenteuer-orte.js', FA = 'server/sim/faden.js', PR = 'server/sim/faden-pruefer.js', BP = 'server/sim/faden-bauplan.js', AP = 'server/sim/abenteuer-prompt.js';
const SB = 'content/schema/faden-bauplan.schema.json', BE = 'content/faeden/beats.json', OD = 'content/welt/abenteuer-orte.json';
// [Datei, Anker (genau einmal), Ersatz, Beschreibung]
const MUTATIONEN = [
  // Pruefregeln (faden-pruefer.pruefeLandeplaetze)
  [PR, "if (liste.length > OD.orte_max) return fehl('LANDEPLATZ_ANZAHL'", "if (false) return fehl('LANDEPLATZ_ANZAHL'", 'Regel: Obergrenze der Plaetze entfernt'],
  [PR, " || !muster(OD.platz_muster).test(p.id)) return fehl('LANDEPLATZ_FORM'", ") return fehl('LANDEPLATZ_FORM'", 'Regel: Muster der Platz-id entfernt'],
  [PR, "if (ids.has(p.id)) return fehl('LANDEPLATZ_ID_DOPPELT'", "if (false) return fehl('LANDEPLATZ_ID_DOPPELT'", 'Regel: doppelte id entfernt'],
  [PR, "if (!OD.arten.includes(p.art)) return fehl('LANDEPLATZ_ART_UNBEKANNT'", "if (false) return fehl('LANDEPLATZ_ART_UNBEKANNT'", 'Regel: unbekannte Kartenart entfernt'],
  [PR, "if (p.besitz !== undefined && !(typeof p.besitz", "if (false && !(typeof p.besitz", 'Regel: Besitz-Muster entfernt'],
  [PR, "if (p.name !== undefined && !(typeof p.name === 'string'", "if (false && !(typeof p.name === 'string'", 'Regel: Name (Laenge, Platzhalter) entfernt'],
  [PR, "for (const b of nutzer) if (!ids.has(b.parameter.landeplatz)) return fehl('LANDEPLATZ_UNBEKANNT'", "for (const b of nutzer) if (false) return fehl('LANDEPLATZ_UNBEKANNT'", 'Regel: Beat-Verweis auf unbekannte id entfernt'],
  [PR, "for (const p of liste) if (!nutzer.some((b) => b.parameter.landeplatz === p.id)) return fehl('LANDEPLATZ_UNBENUTZT'", "for (const p of liste) if (false) return fehl('LANDEPLATZ_UNBENUTZT'", 'Regel: ungenutzter Platz entfernt'],
  [PR, "const g = AO.grundAmHex(hex, p.art); if (g) return fehl('LANDEPLATZ_ART'", "const g = AO.grundAmHex(hex, p.art); if (false) return fehl('LANDEPLATZ_ART'", 'Eignung am Hex: Pruefregel entfernt'],
  [AO, "  if (moeglicheArten(hex).includes(art)) return null;", "", 'Eignung am Hex: grundAmHex lehnt alles ab (Arten des Hex ignoriert)'],
  [AO, "  const k = am.koerper.find((x) => x.arten.includes(def.art));", "  const k = am.koerper[0];", 'Beat-Start: nicht der erste GEEIGNETE Koerper'],
  [AO, "  if (!am.punkt.includes(def.art)) return null;", "", 'Beat-Start: jede Art darf an den Raumpunkt'],
  [AO, "  const hex = f.parameter && f.parameter.ort;", "  const hex = '0904';", 'Beat-Start: nicht der Hex der Geschichte'],
  [AO, "    if (a >= L.abstand_min) return p;", "    return p;", 'Raumpunkt: Abstand zu den Massen der Szene ignoriert'],
  // Ortswechsel (Review W1)
  [PR, "if (verlegt.has(p.id) && !punkt.includes(p.art)) return fehl('LANDEPLATZ_VERLEGT'", "if (false) return fehl('LANDEPLATZ_VERLEGT'", 'Ortswechsel: Pruefregel LANDEPLATZ_VERLEGT entfernt'],
  [PR, "if (verlegt.has(p.id) && !punkt.includes(p.art))", "if (verlegt.has(p.id))", 'Ortswechsel: auch Raumpunkt-Arten nach dem Ortswechsel abgelehnt'],
  [PR, "if (typeof id === 'string' && !bestellt.includes(id)) {", "if (typeof id === 'string') {", 'Ortswechsel: ein davor schon bestellter Platz zaehlt als verlegt'],
  [PR, "const verl = Array.from(new Set(verlegt.concat(typen))).sort();", "const verl = verlegt;", 'Ortswechsel: der verlegende Beat verlegt nie'],
  [PR, "for (const ag of W.ausgaenge) for (const o of [b.aus[ag]].concat(", "for (const ag of ['gelungen']) for (const o of [b.aus[ag]].concat(", 'Ortswechsel: nur der Weg des Gelingens wird verfolgt'],
  [PR, "if (c.verlegt_ort !== undefined && c.verlegt_ort !== true)", "if (false)", 'Katalogcheck verlegt_ort (nur true) entfernt'],
  [BE, "\"baustein\": \"geruecht\",\n      \"verlegt_ort\": true,", "\"baustein\": \"geruecht\",", 'Daten: geruecht verlegt den Ort nicht (verlegt_ort fehlt)'],
  [AP, " genutzt: nur ${liste(require", " genutzt: ${liste(require", 'Prompt: der Satz zum Ortswechsel nennt die Raumpunkt-Arten nicht'],
  // Vorlage-Dateien (Review klein 2)
  [PR, "if (v.landeplaetze === undefined && !beat) return null;", "if (!beat) return null;", 'Vorlage-Datei: das Plan-Feld landeplaetze wird nicht abgelehnt'],
  [PR, "const beat = Array.isArray(v.beats) ? v.beats.find(", "const beat = false ? v.beats.find(", 'Vorlage-Datei: der Beat-Parameter landeplatz wird nicht abgelehnt'],
  ["server/sim/faden-daten.js", "  if (lp) return { ok: false, fehler: [lp] };", "", 'Vorlage-Datei: registriere ruft die Pruefung nicht aus'],
  // Haken
  [FA, "const lpg = P.pruefeLandeplaetze(game, r.vorlage, o.hex);", "const lpg = null;", 'Haken: anbietenMit prueft die Landeplaetze nicht'],
  [FA, "const lpg = P.pruefeLandeplaetze(game, a.vorlage, a.hex);", "const lpg = null;", 'Haken: abenteuerOeffnen prueft die Landeplaetze nicht'],
  [FA, "const lpFehler = require('./abenteuer-orte.js').beatStarten(game, f, beat);", "const lpFehler = null;", 'Haken: der Beat-Start bestellt keinen Landeplatz'],
  [FA, "{ faden: f.id, beat: beat.id }); r = { ausgang: 'gescheitert' }; }\n  else try", "{ faden: f.id, beat: beat.id }); r = null; }\n  else try", 'Haken: ein Beat ohne Landeplatz scheitert nicht (haengt im Lauf)'],
  [AO, "return platzBestellen(game, f.id, def) ? null :", "return (platzBestellen(game, f.id, def), 1) ? null :", 'beatStarten: ein fehlgeschlagenes Bestellen wird verschluckt'],
  [AO, "  } catch (e) { fehler(game, 'abenteuer-orte-beat', e); return", "  } catch (e) { throw e; return", 'beatStarten: eine Ausnahme fliegt weiter'],
  [AO, "  const da = landeplatzVon(game, fadenId, def.id);\n  if (da) return da;", "", 'Idempotenz: platzBestellen prueft landeplatzVon nicht zuerst'],
  // Expander, Schema, Daten
  [BP, "if (plan.landeplaetze !== undefined) v.landeplaetze =", "if (false) v.landeplaetze =", 'Expander: die Landeplaetze kommen nicht in die Vorlage'],
  [BP, "if (erlaubt === 'landeplatz') return typeof wert === 'string' && new RegExp('^' + ORTE.platz_muster + '$').test(wert);", "if (erlaubt === 'landeplatz') return true;", 'Expander: Muster des Beat-Parameters landeplatz entfernt'],
  [BP, "if (s.standard !== undefined) p[k] = s.standard;", "p[k] = s.standard;", 'Expander: ein Parameter ohne Standard bekommt undefined'],
  [SB, "\"additionalProperties\": false,\n        \"required\": [\"id\", \"art\"],", "\"required\": [\"id\", \"art\"],", 'Schema: unbekannte Felder am Landeplatz (seed, biom) erlaubt'],
  [SB, "\"additionalProperties\": false,\n  \"required\": [\"format\", \"titel\", \"beats\"],", "\"required\": [\"format\", \"titel\", \"beats\"],", 'Schema: unbekannte Felder am Plan (ort) erlaubt'],
  [BE, "\"optional\": [\"text_key\", \"hex\", \"landeplatz\"]", "\"optional\": [\"text_key\", \"hex\"]", 'Daten: notruf deklariert landeplatz nicht'],
  [BE, "\"optional\": [\"text_key\", \"text_key_kein_ziel\", \"landeplatz\"]", "\"optional\": [\"text_key\", \"text_key_kein_ziel\"]", 'Daten: bitte deklariert landeplatz nicht'],
  [OD, "\"abstand_min\": 200,", "\"abstand_min\": 0,", 'Daten: Mindestabstand des Raumpunkts 0'],
  // Prompt
  [AP, "    landeplatz_arten: Orte.moeglicheArten(hex),", "", 'Prompt: der Kontext nennt die Kartenarten des Hex nicht'],
  [AP, "jeder Platz braucht einen Beat.", "jeder Platz ist frei.", 'Prompt: die Regel "jeder Platz braucht einen Beat" fehlt'],
  [AP, "    if (s.erlaubt === 'landeplatz') return `${k} (id)`;", "", 'Prompt: der Parameter landeplatz wird falsch beschrieben'],
];

{   // Selbstcheck: jeder Anker genau einmal
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    const t = fs.readFileSync(path.join(TMP, datei), 'utf8').replace(/\r\n/g, '\n');
    const k = t.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k}x in ${datei}`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); loesche(); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { loesche(); process.exit(0); }
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 300000, env: Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'node_modules') }) });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
const basis = lauf();
console.log(`Mutationsprobe test-abenteuer-landeplaetze.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP}); Ausgangslage ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /✗/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); loesche(); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  const rot = ((r.stdout || '').split('\n')).filter((l) => /^✗/.test(l) && !/Absturz/.test(l));
  if (r.status !== 0 && rot.length) { erkannt++; console.log(`  rot    ${was} (${rot.length} Pruefung(en), z. B. ${rot[0].replace(/^✗\s*/, '').slice(0, 70)})`); }
  else if (r.status !== 0) { abstuerze++; console.log(`  ABSTURZ ${was} (Exit ${r.status}: ${((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|Absturz/.test(l)).slice(0, 1).join(' ').slice(0, 100)}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
loesche();
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
