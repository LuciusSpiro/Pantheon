'use strict';
// Katalog-Registry (Konzept S1/S2, Vorarbeit): lädt Szenentypen und Moleküle aus Dateien, auch aus Mods, prüft sie und
// bestimmt, was verfügbar und was geplant ist. Ebenen:
//   Bausteine  (Code, concept/regiebuch/bausteine.json)  – Aktionen und Prüfungen der Engine
//   Mechaniken (Code, concept/katalog/mechaniken.json)   – was die Engine kann bzw. noch nicht kann
//   Moleküle   (Daten, concept/katalog/molekuele/*.json)  – Spielziele mit Umsetzungen (Regiebuch-Vorlagen)
//   Szenentypen(Daten, concept/katalog/szenentypen/*.json)– Rahmen einer Szene
// Mods: mods/<name>/katalog/{molekuele,szenentypen}/*.json (nur Daten; Mechaniken und Bausteine bleiben Studio-Sache).
// Verfügbar ist eine Umsetzung, wenn alle Mechaniken in 'braucht' verfügbar sind UND ihre Vorlage, mit den Testwerten
// eingesetzt, den Regiebuch-Prüfer besteht. Ein Molekül ist verfügbar, wenn eine Umsetzung verfügbar ist.
// Aufruf: node tools/katalog.js [--spielleiter kurz|voll] [--mod <ordner>] [--quiet]

const fs = require('fs');
const path = require('path');
const { check, validate } = require('./check-missions.js');

const ROOT = path.join(__dirname, '..');
const KAT = path.join(ROOT, 'concept', 'katalog');
const SCHEMA_M = JSON.parse(fs.readFileSync(path.join(KAT, 'schema', 'molekuel.schema.json'), 'utf8'));
const SCHEMA_S = JSON.parse(fs.readFileSync(path.join(KAT, 'schema', 'szenentyp.schema.json'), 'utf8'));
const MECH = JSON.parse(fs.readFileSync(path.join(KAT, 'mechaniken.json'), 'utf8')).mechaniken;

// ---------- Vorlagen einsetzen ----------
// Platzhalter {{name}}: ganzer String -> Wert (beliebiger Typ), sonst Textersetzung. Gilt auch für Objektschlüssel.
function expand(node, vars) {
  if (typeof node === 'string') {
    const whole = node.match(/^\{\{([a-z0-9_]+)\}\}$/);
    if (whole && whole[1] in vars) return JSON.parse(JSON.stringify(vars[whole[1]]));
    return node.replace(/\{\{([a-z0-9_]+)\}\}/g, (all, k) => (k in vars ? String(vars[k]) : all));
  }
  if (Array.isArray(node)) return node.map((x) => expand(x, vars));
  if (node && typeof node === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(node)) o[expand(k, vars)] = expand(v, vars);
    return o;
  }
  return node;
}
// Parameter mit Defaults auffüllen und prüfen
function resolveParams(u, given) {
  const errs = []; const vars = {};
  for (const [n, d] of Object.entries(u.params)) {
    let v = n in given ? given[n] : d.default;
    if (v === undefined) { if (d.pflicht) errs.push(`Parameter '${n}' fehlt`); continue; }
    if (d.werte && !d.werte.includes(v)) errs.push(`Parameter '${n}' = ${JSON.stringify(v)} nicht in ${JSON.stringify(d.werte)}`);
    if (d.typ === 'zahl' && typeof v !== 'number') errs.push(`Parameter '${n}' muss eine Zahl sein`);
    if (d.typ === 'zahl' && d.min != null && v < d.min) errs.push(`Parameter '${n}' kleiner als ${d.min}`);
    if (d.typ === 'zahl' && d.max != null && v > d.max) errs.push(`Parameter '${n}' größer als ${d.max}`);
    if (d.typ === 'aktionen' && !Array.isArray(v)) errs.push(`Parameter '${n}' muss eine Aktionsliste sein`);
    vars[n] = v;
  }
  for (const n of Object.keys(given)) if (!(n in u.params)) errs.push(`unbekannter Parameter '${n}'`);
  return { vars, errs };
}
// Umsetzung -> Regiebuch-Fragment (für eine Szene). id = Instanz-Präfix, weiter = Folgeschritt.
function instantiate(u, given, id, weiter) {
  const { vars, errs } = resolveParams(u, given);
  const frag = expand(u.vorlage, Object.assign({}, vars, { id, weiter }));
  return { frag, errs };
}
// Testregiebuch um ein Fragment herum (für die Prüfung beim Laden)
function testRegiebuch(frag, molId, u) {
  const merge = (a, b) => { const o = Object.assign({}, a); for (const [k, v] of Object.entries(b || {})) o[k] = Array.isArray(v) ? [...new Set([...(o[k] || []), ...v])] : (v && typeof v === 'object' ? merge(o[k] || {}, v) : v); return o; };
  const buehne = merge({ orte: ['hafen'] }, frag.buehne);
  const besetzung = merge({ npc: ['tesk'] }, frag.besetzung);
  return {
    format: 'regiebuch/1', id: `t_${u.id}`.slice(0, 40),
    kopf: { titel: `Test ${u.name}`.slice(0, 60), art: 'mission', auftraggeber: 'tesk', zielspieldauer_min: Math.max(1, u.dauer_min[1]) },
    buch: { von: [{ npc: 'tesk' }], briefing: '@test.text', belohnung: '@test.text' },
    buehne, besetzung,
    steps: frag.steps.concat([{ id: 'test_ende', objectives: [], next: [{ if: true, complete: 'erfolg' }], skip: [] }]),
    on: frag.on || {},
    ausgaenge: { erfolg: { beschreibung: 'Test', folgen: [{ chronik: '@test.text' }] } },
    texte: Object.assign({ 'test.text': 'Test' }, frag.texte),
  };
}

// ---------- Laden ----------
function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const file = path.join(dir, f);
    try { return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { return { file, error: 'kein gültiges JSON: ' + e.message }; }
  });
}
function load(opts) {
  opts = opts || {};
  const quellen = [{ name: 'kern', dir: KAT }];
  const modsDir = path.join(ROOT, 'mods');
  if (fs.existsSync(modsDir)) for (const m of fs.readdirSync(modsDir)) quellen.push({ name: 'mod:' + m, dir: path.join(modsDir, m, 'katalog') });
  for (const d of opts.mods || []) quellen.push({ name: 'mod:' + path.basename(d), dir: path.join(d, 'katalog') });
  const fehler = []; const szenentypen = {}; const molekuele = {};
  for (const q of quellen) {
    for (const { file, data, error } of readDir(path.join(q.dir, 'szenentypen'))) {
      const rel = path.relative(ROOT, file);
      if (error) { fehler.push({ datei: rel, msg: error }); continue; }
      const out = []; validate(data, SCHEMA_S, '$', out, SCHEMA_S);
      if (out.length) { fehler.push(...out.map(([p, m]) => ({ datei: rel, msg: `${p}: ${m}` }))); continue; }
      if (szenentypen[data.id]) { fehler.push({ datei: rel, msg: `Szenentyp '${data.id}' gibt es schon (${szenentypen[data.id].quelle_datei})` }); continue; }
      szenentypen[data.id] = Object.assign({}, data, { quelle_datei: rel, herkunft: q.name });
    }
    for (const { file, data, error } of readDir(path.join(q.dir, 'molekuele'))) {
      const rel = path.relative(ROOT, file);
      if (error) { fehler.push({ datei: rel, msg: error }); continue; }
      const out = []; validate(data, SCHEMA_M, '$', out, SCHEMA_M);
      if (out.length) { fehler.push(...out.map(([p, m]) => ({ datei: rel, msg: `${p}: ${m}` }))); continue; }
      const umsetzungen = data.umsetzungen.map((u) => Object.assign({}, u, { quelle_datei: rel, herkunft: q.name }));
      if (molekuele[data.id]) {
        if (!data.erweitert) { fehler.push({ datei: rel, msg: `Molekül '${data.id}' gibt es schon – für zusätzliche Umsetzungen "erweitert": true setzen` }); continue; }
        const ziel = molekuele[data.id];
        ziel.umsetzungen.push(...umsetzungen);
        // Erweiterung darf weitere Szenentypen und Ansätze ergänzen (nie entfernen)
        ziel.szenentypen = [...new Set(ziel.szenentypen.concat(data.szenentypen))];
        ziel.ansaetze = [...new Set(ziel.ansaetze.concat(data.ansaetze))];
      } else molekuele[data.id] = Object.assign({}, data, { umsetzungen, quelle_datei: rel, herkunft: q.name });
    }
  }

  // Querverweise und Verfügbarkeit
  const kennungen = new Set(Object.values(szenentypen).map((s) => s.kennung));
  const mechOk = (list) => list.filter((m) => !MECH[m] || MECH[m].status !== 'verfuegbar');
  for (const s of Object.values(szenentypen)) {
    for (const k of s.kippt_zu) if (!szenentypen[k]) fehler.push({ datei: s.quelle_datei, msg: `kippt_zu: Szenentyp '${k}' unbekannt` });
    for (const m of s.braucht) if (!MECH[m]) fehler.push({ datei: s.quelle_datei, msg: `braucht: Mechanik '${m}' unbekannt` });
  }
  for (const m of Object.values(molekuele)) {
    for (const k of m.szenentypen) if (!kennungen.has(k)) fehler.push({ datei: m.quelle_datei, msg: `Szenentyp '${k}' unbekannt` });
    const ids = new Set();
    for (const u of m.umsetzungen) {
      if (ids.has(u.id)) fehler.push({ datei: u.quelle_datei, msg: `Umsetzung '${u.id}' doppelt in '${m.id}'` });
      ids.add(u.id);
      for (const x of u.braucht) if (!MECH[x]) fehler.push({ datei: u.quelle_datei, msg: `Umsetzung '${u.id}': Mechanik '${x}' unbekannt` });
      // 'nach': Voraussetzung muss als Molekül/Umsetzung registriert sein (alle Dateien sind hier schon geladen)
      for (const n of u.nach || []) { const [mm, uu] = n.split('/'); if (!molekuele[mm] || !molekuele[mm].umsetzungen.some((x) => x.id === uu)) fehler.push({ datei: u.quelle_datei, msg: `Umsetzung '${u.id}': 'nach' verweist auf unbekannte Umsetzung '${n}'` }); }
      const fehlend = mechOk(u.braucht);
      // Vorlage mit Testwerten prüfen
      const { frag, errs } = instantiate(u, u.test.params, 's1', 'test_ende');
      let pruefung = { errors: errs.map((e) => ({ code: 'PARAM', p: 'test.params', msg: e })), warnings: [] };
      if (!errs.length) pruefung = check(testRegiebuch(frag, m.id, u));
      u.pruefung = { fehler: pruefung.errors.length, warnungen: pruefung.warnings.length, details: pruefung.errors };
      u.fehlende_mechaniken = fehlend;
      u.status = pruefung.errors.length ? 'fehlerhaft' : fehlend.length ? 'geplant' : 'verfuegbar';
      if (pruefung.errors.length) fehler.push(...pruefung.errors.map((e) => ({ datei: u.quelle_datei, msg: `Umsetzung '${u.id}' besteht den Prüfer nicht: ${e.code} ${e.p} – ${e.msg}` })));
    }
    m.status = m.umsetzungen.some((u) => u.status === 'verfuegbar') ? 'verfuegbar' : 'geplant';
  }
  for (const s of Object.values(szenentypen)) {
    const fehlend = mechOk(s.braucht);
    // passend = Molekül nennt den Szenentyp UND hat eine verfügbare Umsetzung, deren Schauplatz zum Bereich passt
    const passend = Object.values(molekuele).filter((m) => m.szenentypen.includes(s.kennung) && m.umsetzungen.some((u) => u.status === 'verfuegbar' && u.schauplatz === s.bereich));
    s.fehlende_mechaniken = fehlend;
    s.verfuegbare_molekuele = passend.map((m) => m.id);
    s.status = fehlend.length ? 'geplant' : (s.molekuele_plaetze.min > 0 && !passend.length) ? 'geplant' : 'verfuegbar';
  }
  return { szenentypen, molekuele, mechaniken: MECH, fehler };
}

// ---------- Katalog für den Spielleiter ----------
// kurz: für den Grobplan (Namen, Kern, Passung). voll: zusätzlich Umsetzungen mit Parametern (für das Ausarbeiten).
function fuerSpielleiter(k, stufe) {
  const L = [];
  const st = Object.values(k.szenentypen).sort((a, b) => a.kennung.localeCompare(b.kennung, 'de', { numeric: true }));
  L.push('## Szenentypen (verfügbar)');
  for (const s of st.filter((x) => x.status === 'verfuegbar')) L.push(`- ${s.kennung} \`${s.id}\` – ${s.name}: ${s.kern}${s.verfuegbare_molekuele.length ? ` Moleküle: ${s.verfuegbare_molekuele.join(', ')}.` : ''}${s.kippt_zu.length ? ` Kippt zu: ${s.kippt_zu.join(', ')}.` : ''}`);
  L.push('', '## Moleküle (verfügbar)');
  for (const m of Object.values(k.molekuele).filter((x) => x.status === 'verfuegbar').sort((a, b) => a.id.localeCompare(b.id))) {
    L.push(`- \`${m.id}\` – ${m.name}: ${m.kern} (Ansätze: ${m.ansaetze.join(', ') || '–'}; Szenentypen: ${m.szenentypen.join(', ')})`);
    for (const u of m.umsetzungen.filter((x) => x.status === 'verfuegbar')) {
      L.push(`  - Umsetzung \`${u.id}\` (${u.schauplatz}, ${u.dauer_min[0]}–${u.dauer_min[1]} min${u.params.loc && u.params.loc.werte ? ', nur an: ' + u.params.loc.werte.join('/') : ''}${(u.nach || []).length ? ', erst nach: ' + u.nach.join(', ') : ''}): ${u.beschreibung}`);
      if (stufe === 'voll') L.push(`    Parameter: ${Object.entries(u.params).map(([n, d]) => `${n}${d.pflicht ? '*' : ''}:${d.typ}${d.werte ? '(' + d.werte.join('|') + ')' : ''}${d.default !== undefined ? '=' + JSON.stringify(d.default) : ''}`).join(', ')}`);
    }
  }
  L.push('', '## Noch nicht spielbar (nicht verwenden; bei Bedarf als Wunsch notieren)');
  L.push(`Szenentypen: ${st.filter((x) => x.status !== 'verfuegbar').map((s) => s.name).join(', ')}.`);
  L.push(`Moleküle: ${Object.values(k.molekuele).filter((x) => x.status !== 'verfuegbar').map((m) => m.name).join(', ')}.`);
  return L.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const k = load({ mods: args.filter((a, i) => args[i - 1] === '--mod').map((d) => path.resolve(d)) });
  if (args.includes('--spielleiter')) { console.log(fuerSpielleiter(k, args[args.indexOf('--spielleiter') + 1] || 'kurz')); process.exit(k.fehler.length ? 1 : 0); }
  const sV = Object.values(k.szenentypen); const mV = Object.values(k.molekuele); const uV = mV.flatMap((m) => m.umsetzungen.map((u) => Object.assign({ mol: m.id }, u)));
  console.log(`Szenentypen: ${sV.length} (verfügbar ${sV.filter((s) => s.status === 'verfuegbar').length}, geplant ${sV.filter((s) => s.status === 'geplant').length})`);
  console.log(`Moleküle:    ${mV.length} (verfügbar ${mV.filter((m) => m.status === 'verfuegbar').length}, geplant ${mV.filter((m) => m.status === 'geplant').length})`);
  console.log(`Umsetzungen: ${uV.length} (verfügbar ${uV.filter((u) => u.status === 'verfuegbar').length}, geplant ${uV.filter((u) => u.status === 'geplant').length}, fehlerhaft ${uV.filter((u) => u.status === 'fehlerhaft').length})`);
  if (!args.includes('--quiet')) {
    console.log('\nUmsetzungen:');
    for (const u of uV) console.log(`  ${u.status === 'verfuegbar' ? '✓' : u.status === 'geplant' ? '…' : '✗'} ${u.mol}/${u.id} (${u.herkunft})${u.fehlende_mechaniken.length ? ' – fehlt: ' + u.fehlende_mechaniken.join(', ') : ''}${u.pruefung.warnungen ? ` – ${u.pruefung.warnungen} Warnungen` : ''}`);
    console.log('\nSzenentypen verfügbar: ' + sV.filter((s) => s.status === 'verfuegbar').map((s) => `${s.kennung} ${s.name}`).join(', '));
  }
  if (k.fehler.length) { console.log(`\n${k.fehler.length} Fehler:`); for (const f of k.fehler) console.log(`  ✗ ${f.datei}: ${f.msg}`); }
  process.exit(k.fehler.length ? 1 : 0);
}

module.exports = { load, instantiate, expand, fuerSpielleiter, testRegiebuch };
