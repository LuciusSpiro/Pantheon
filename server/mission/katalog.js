'use strict';
// Katalog (CONTRACT-S1 §1/§8, Bibliothek; Kommandozeile: tools/katalog.js): lädt Szenentypen und Moleküle aus Dateien,
// auch aus Mods, prüft sie und bestimmt, was verfügbar und was geplant ist. Ebenen:
//   Bausteine  (Code, server/mission/registry.js)           – Aktionen und Prüfungen der Engine
//   Mechaniken (Code, content/katalog/mechaniken.json)       – was die Engine kann bzw. noch nicht kann
//   Moleküle   (Daten, content/katalog/molekuele/*.json)     – Spielziele mit Umsetzungen (Regiebuch-Vorlagen)
//   Szenentypen(Daten, content/katalog/szenentypen/*.json)   – Rahmen einer Szene
// Mods: mods/<name>/katalog/{molekuele,szenentypen}/*.json (nur Daten; Mechaniken und Bausteine bleiben Studio-Sache).
// Verfügbar ist eine Umsetzung, wenn alle Mechaniken in 'braucht' verfügbar sind UND ihre Vorlage, mit den Testwerten
// eingesetzt, den Regiebuch-Prüfer besteht. Ein Molekül ist verfügbar, wenn eine Umsetzung verfügbar ist.
const fs = require('fs');
const path = require('path');
const Checker = require('./checker.js');

const ROOT = path.join(__dirname, '..', '..');
const KAT = path.join(ROOT, 'content', 'katalog');
let cache = null;
function schemas() {
  if (cache) return cache;
  cache = {
    M: JSON.parse(fs.readFileSync(path.join(KAT, 'schema', 'molekuel.schema.json'), 'utf8')),
    S: JSON.parse(fs.readFileSync(path.join(KAT, 'schema', 'szenentyp.schema.json'), 'utf8')),
    MECH: JSON.parse(fs.readFileSync(path.join(KAT, 'mechaniken.json'), 'utf8')).mechaniken,
    // B2 §7: Gegner-Registry und Fraktionen (Schema ENGINE, Inhalt KATALOG)
    G: JSON.parse(fs.readFileSync(path.join(KAT, 'schema', 'gegner.schema.json'), 'utf8')),
    F: JSON.parse(fs.readFileSync(path.join(KAT, 'schema', 'fraktion.schema.json'), 'utf8')),
  };
  return cache;
}

// S2: Namen aller Bausteine, die im Vertrag content/regiebuch/bausteine.json stehen (Aktionen + Prüfungen)
function vertragsBausteine() {
  try {
    const bs = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
    return new Set([...Object.keys(bs.aktionen || {}), ...Object.keys(bs.pruefungen || {})]);
  } catch (e) { return new Set(); }
}

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
    const v = n in given ? given[n] : d.default;
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
    ausgaenge: { erfolg: { beschreibung: 'Test', folgen: [{ do: 'chronik', text: '@test.text' }] } },
    texte: Object.assign({ 'test.text': 'Test' }, frag.texte),
  };
}

// ---------- Laden ----------
function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const file = path.join(dir, f);
    try { return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { return { file, error: 'kein gültiges JSON: ' + e.message }; }
  });
}
function load(opts) {
  opts = opts || {};
  const { M: SCHEMA_M, S: SCHEMA_S, MECH } = schemas();
  const quellen = [{ name: 'kern', dir: KAT }];
  const modsDir = path.join(ROOT, 'mods');
  if (fs.existsSync(modsDir)) for (const m of fs.readdirSync(modsDir)) quellen.push({ name: 'mod:' + m, dir: path.join(modsDir, m, 'katalog') });
  for (const d of opts.mods || []) quellen.push({ name: 'mod:' + path.basename(d), dir: path.join(d, 'katalog') });
  const fehler = []; const szenentypen = {}; const molekuele = {}; const gegner = {}; const fraktionen = {};
  for (const q of quellen) {
    // B2 §7: gegner/<rolle>.json, fraktionen/<id>.json (Mods dürfen ergänzen, nicht überschreiben)
    for (const [sub, SCH, ziel, was] of [['gegner', schemas().G, gegner, 'Gegnerrolle'], ['fraktionen', schemas().F, fraktionen, 'Fraktion']]) {
      for (const { file, data, error } of readDir(path.join(q.dir, sub))) {
        const rel = path.relative(ROOT, file);
        if (error) { fehler.push({ datei: rel, msg: error }); continue; }
        const out = Checker.validate(data, SCH, '$', [], SCH);
        if (out.length) { fehler.push(...out.map(([p, m]) => ({ datei: rel, msg: `${p}: ${m}` }))); continue; }
        if (ziel[data.id]) { fehler.push({ datei: rel, msg: `${was} '${data.id}' gibt es schon (${ziel[data.id].quelle_datei})` }); continue; }
        ziel[data.id] = Object.assign({}, data, { quelle_datei: rel, herkunft: q.name });
      }
    }
    for (const { file, data, error } of readDir(path.join(q.dir, 'szenentypen'))) {
      const rel = path.relative(ROOT, file);
      if (error) { fehler.push({ datei: rel, msg: error }); continue; }
      const out = Checker.validate(data, SCHEMA_S, '$', [], SCHEMA_S);
      if (out.length) { fehler.push(...out.map(([p, m]) => ({ datei: rel, msg: `${p}: ${m}` }))); continue; }
      if (szenentypen[data.id]) { fehler.push({ datei: rel, msg: `Szenentyp '${data.id}' gibt es schon (${szenentypen[data.id].quelle_datei})` }); continue; }
      szenentypen[data.id] = Object.assign({}, data, { quelle_datei: rel, herkunft: q.name });
    }
    for (const { file, data, error } of readDir(path.join(q.dir, 'molekuele'))) {
      const rel = path.relative(ROOT, file);
      if (error) { fehler.push({ datei: rel, msg: error }); continue; }
      const out = Checker.validate(data, SCHEMA_M, '$', [], SCHEMA_M);
      if (out.length) { fehler.push(...out.map(([p, m]) => ({ datei: rel, msg: `${p}: ${m}` }))); continue; }
      const umsetzungen = data.umsetzungen.map((u) => Object.assign({}, u, { quelle_datei: rel, herkunft: q.name }));
      if (molekuele[data.id]) {
        if (!data.erweitert) { fehler.push({ datei: rel, msg: `Molekül '${data.id}' gibt es schon – für zusätzliche Umsetzungen "erweitert": true setzen` }); continue; }
        const ziel = molekuele[data.id];
        ziel.umsetzungen.push(...umsetzungen);
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
      for (const n of u.nach || []) { const [mm, uu] = n.split('/'); if (!molekuele[mm] || !molekuele[mm].umsetzungen.some((x) => x.id === uu)) fehler.push({ datei: u.quelle_datei, msg: `Umsetzung '${u.id}': 'nach' verweist auf unbekannte Umsetzung '${n}'` }); }
      const fehlend = mechOk(u.braucht);
      const { frag, errs } = instantiate(u, u.test.params, 's1', 'test_ende');
      let pruefung = { errors: errs.map((e) => ({ code: 'PARAM', p: 'test.params', msg: e })), warnings: [] };
      if (!errs.length) pruefung = Checker.check(testRegiebuch(frag, m.id, u));
      u.pruefung = { fehler: pruefung.errors.length, warnungen: pruefung.warnings.length, details: pruefung.errors };
      u.fehlende_mechaniken = fehlend;
      // S2 (Studioleitung): Fehlen nur Bausteine, die als Vertrag in content/regiebuch/bausteine.json stehen (noch nicht
      // geliefert), ist die Umsetzung 'geplant' (fehlende_bausteine) statt 'fehlerhaft' – kein Eintrag in k.fehler.
      const errs2 = pruefung.errors;
      const missingB = errs2.length && errs2.every((e) => e.code === 'REF-BAUSTEIN' || e.code === 'REF-PRUEFUNG')
        ? [...new Set(errs2.map((e) => (/'([a-z0-9_]+)'/.exec(e.msg) || [])[1]).filter(Boolean))] : [];
      const contract = vertragsBausteine();
      if (missingB.length && missingB.every((b) => contract.has(b)) && errs2.every((e) => /'([a-z0-9_]+)'/.test(e.msg))) {
        u.fehlende_bausteine = missingB;
        u.status = 'geplant';
        continue;
      }
      u.status = pruefung.errors.length ? 'fehlerhaft' : fehlend.length ? 'geplant' : 'verfuegbar';
      if (pruefung.errors.length) fehler.push(...pruefung.errors.map((e) => ({ datei: u.quelle_datei, msg: `Umsetzung '${u.id}' besteht den Prüfer nicht: ${e.code} ${e.p} – ${e.msg}` })));
    }
    m.status = m.umsetzungen.some((u) => u.status === 'verfuegbar') ? 'verfuegbar' : 'geplant';
  }
  for (const s of Object.values(szenentypen)) {
    const fehlend = mechOk(s.braucht);
    const passend = Object.values(molekuele).filter((m) => m.szenentypen.includes(s.kennung) && m.umsetzungen.some((u) => u.status === 'verfuegbar' && u.schauplatz === s.bereich));
    s.fehlende_mechaniken = fehlend;
    s.verfuegbare_molekuele = passend.map((m) => m.id);
    s.status = fehlend.length ? 'geplant' : (s.molekuele_plaetze.min > 0 && !passend.length) ? 'geplant' : 'verfuegbar';
  }
  // B2 §7: Fraktionen verweisen nur auf bekannte Rollen (GEGNER-TYP), sobald die Gegner-Registry Einträge hat
  const rollenBekannt = new Set(Object.values(gegner).map((x) => x.rolle));
  if (rollenBekannt.size) for (const f of Object.values(fraktionen)) {
    for (const [rz, trupp] of Object.entries(f.rezepte || {})) for (const t of trupp) if (!rollenBekannt.has(t.rolle)) fehler.push({ datei: f.quelle_datei, msg: `GEGNER-TYP: Rezept '${rz}' nutzt Rolle '${t.rolle}' ohne content/katalog/gegner/*.json` });
    for (const rz of Object.keys(f.einsatz || {})) if (!(f.rezepte || {})[rz]) fehler.push({ datei: f.quelle_datei, msg: `FRAKTION: einsatz nennt unbekanntes Rezept '${rz}'` });
  }
  return { szenentypen, molekuele, mechaniken: MECH, gegner, fraktionen, fehler };
}

// ---------- Katalog für den Spielleiter ----------
// B1 §11.1: Bühnenbedarf einer Umsetzung als eine Zeile (Kartenart; Anker; Mindestzahlen; Gefechtsbereich) bzw. feste
// Landepunkte (params.map.werte). Kein Bedarf -> ''.
function buehneBrauchtText(u) {
  const b = u && u.buehne_braucht;
  if (b && typeof b === 'object') {
    const anker = (b.anker || []).map((a) => (typeof a === 'string' ? a : `${a.rolle}${a.paar ? '-Paar' : ''}`));
    for (const [r, n] of Object.entries(b.min || {})) { const i = anker.indexOf(r); const t = `${r}≥${n}`; if (i >= 0) anker[i] = t; else anker.push(t); }
    return `${(b.kartenarten || ['alle']).join('/')}; Anker ${anker.join(', ') || '–'}${b.gefecht ? '; Gefechtsbereich' : ''}`;
  }
  if (u && u.params && u.params.map && Array.isArray(u.params.map.werte)) return `nur Landepunkt ${u.params.map.werte.join('/')}`;
  return '';
}
// W1 AP4 (§5.4 Nr. 9): Kurzfassung für den Grobplan. Je Umsetzung genau eine Zeile: ID, Name, Kartenarten bzw. Raum,
// Pflicht-Parameter (ohne loc/map – die setzt das Spiel), Dauer; „nur an“ und „erst nach“ bleiben (Regeln im
// Systemprompt). Keine Beschreibungsprosa, kein „Noch nicht spielbar“ (Ziel −40 % im Katalogteil, Messung:
// node tools/katalog.js --tokens). Die passenden Landepunkte je Bodenumsetzung stehen ohnehin in <vorgaben>.
const VOM_SPIEL = ['loc', 'map', 'landepunkt'];
function kartenText(u) {
  const b = u && u.buehne_braucht;
  if (u.params && u.params.map && Array.isArray(u.params.map.werte)) return `nur Landepunkt ${u.params.map.werte.join('/')}`;
  if (b && typeof b === 'object') return (b.kartenarten || ['alle Kartenarten']).join('/');
  return u.schauplatz === 'weltraum' ? 'Raum' : u.schauplatz;
}
function umsetzungZeile(m, u) {
  const pflicht = Object.entries(u.params || {}).filter(([n, d]) => d && d.pflicht && !VOM_SPIEL.includes(n) && !VOM_SPIEL.includes(d.typ)).map(([n]) => n);
  const teile = [kartenText(u), `${u.dauer_min[0]}–${u.dauer_min[1]} min`];
  if (pflicht.length) teile.push(`Pflicht: ${pflicht.join(', ')}`);
  if (u.params.loc && u.params.loc.werte) teile.push(`nur an: ${u.params.loc.werte.join('/')}`);
  if ((u.nach || []).length) teile.push(`erst nach: ${u.nach.join(', ')}`);
  return `- ${m.id}/${u.id} – ${u.name}; ${teile.join('; ')}`;
}
function fuerGrobplanKurz(k) {
  const L = [];
  const st = Object.values(k.szenentypen).sort((a, b) => a.kennung.localeCompare(b.kennung, 'de', { numeric: true }));
  L.push('## Szenentypen (verfügbar)');
  for (const s of st.filter((x) => x.status === 'verfuegbar')) L.push(`- ${s.kennung} \`${s.id}\` – ${s.name}: ${s.kern}${s.verfuegbare_molekuele.length ? ` Moleküle: ${s.verfuegbare_molekuele.join(', ')}.` : ''}${s.kippt_zu.length ? ` Kippt zu: ${s.kippt_zu.join(', ')}.` : ''}`);
  L.push('', '## Moleküle (verfügbar): Kern, darunter je Umsetzung `molekül/umsetzung` – Name; Karte; Dauer; Pflicht-Parameter');
  for (const m of Object.values(k.molekuele).filter((x) => x.status === 'verfuegbar').sort((a, b) => a.id.localeCompare(b.id))) {
    L.push(`${m.name} (\`${m.id}\`): ${m.kern}`);
    for (const u of m.umsetzungen.filter((x) => x.status === 'verfuegbar')) L.push(umsetzungZeile(m, u));
  }
  return L.join('\n');
}
// kurz: für den Grobplan (eine Zeile je Umsetzung, s. o.). voll: Namen, Kern, Beschreibung, Bühne und Parameter (für das
// Ausarbeiten und Werkzeuge).
function fuerSpielleiter(k, stufe) {
  if (stufe !== 'voll') return fuerGrobplanKurz(k);
  const L = [];
  const st = Object.values(k.szenentypen).sort((a, b) => a.kennung.localeCompare(b.kennung, 'de', { numeric: true }));
  L.push('## Szenentypen (verfügbar)');
  for (const s of st.filter((x) => x.status === 'verfuegbar')) L.push(`- ${s.kennung} \`${s.id}\` – ${s.name}: ${s.kern}${s.verfuegbare_molekuele.length ? ` Moleküle: ${s.verfuegbare_molekuele.join(', ')}.` : ''}${s.kippt_zu.length ? ` Kippt zu: ${s.kippt_zu.join(', ')}.` : ''}`);
  L.push('', '## Moleküle (verfügbar)');
  for (const m of Object.values(k.molekuele).filter((x) => x.status === 'verfuegbar').sort((a, b) => a.id.localeCompare(b.id))) {
    L.push(`- \`${m.id}\` – ${m.name}: ${m.kern} (Ansätze: ${m.ansaetze.join(', ') || '–'}; Szenentypen: ${m.szenentypen.join(', ')})`);
    for (const u of m.umsetzungen.filter((x) => x.status === 'verfuegbar')) {
      L.push(`  - Umsetzung \`${u.id}\` (${u.schauplatz}, ${u.dauer_min[0]}–${u.dauer_min[1]} min${u.params.loc && u.params.loc.werte ? ', nur an: ' + u.params.loc.werte.join('/') : ''}${(u.nach || []).length ? ', erst nach: ' + u.nach.join(', ') : ''}): ${u.beschreibung}`);
      const bb = buehneBrauchtText(u);
      if (bb) L.push(`    Bühne: ${bb}`);
      if (stufe === 'voll') L.push(`    Parameter: ${Object.entries(u.params).map(([n, d]) => `${n}${d.pflicht ? '*' : ''}:${d.typ}${d.werte ? '(' + d.werte.join('|') + ')' : ''}${d.default !== undefined ? '=' + JSON.stringify(d.default) : ''}`).join(', ')}`);
    }
  }
  L.push('', '## Noch nicht spielbar (nicht verwenden; bei Bedarf als Wunsch notieren)');
  L.push(`Szenentypen: ${st.filter((x) => x.status !== 'verfuegbar').map((s) => s.name).join(', ')}.`);
  L.push(`Moleküle: ${Object.values(k.molekuele).filter((x) => x.status !== 'verfuegbar').map((m) => m.name).join(', ')}.`);
  return L.join('\n');
}

// B2 §7 Prüfer-Codes für die Besetzung eines Grobplans bzw. Buchs (Aufruf: szenenbau.checkGrobplan, checker).
//   besetzung = [{ fraktion, staerke, haltung, neue_rolle? }]; ctx = { katalog (load()), rollen_gesehen: [], spieler: n, kartenart? }
// -> { fehler: [{ code, msg }], warnungen: [{ code, msg }] }
//   GEGNER-TYP (Fehler) unbekannte Rolle · FRAKTION (Fehler) unbekannte Fraktion bzw. ohne Rezept für Kartenart/Stärke ·
//   BESETZUNG-NEU (Fehler, 1 Nachbesserung) mehr als eine ausdrücklich genannte, ungesehene neue_rolle je Gefecht;
//   (Warnung) ein Rezept besteht nur aus ungesehenen Rollen (die Laufzeit ersetzt sie durch grundtyp) ·
//   BESETZUNG-SOLO / BESETZUNG-ENTERER (Warnung). Rezeptrollen zählen nicht als neue Rollen (B2 §5/§7, Befund KATALOG).
function pruefeBesetzung(besetzung, ctx) {
  const c = ctx || {}; const k = c.katalog || load();
  const fehler = []; const warnungen = [];
  const gesehen = new Set(c.rollen_gesehen || []);
  const rollen = new Set(Object.values(k.gegner || {}).map((g) => g.rolle));
  const neu = new Set();
  for (const [i, b] of (Array.isArray(besetzung) ? besetzung : []).entries()) {
    const f = (k.fraktionen || {})[b && b.fraktion];
    if (!f) { fehler.push({ code: 'FRAKTION', msg: `besetzung[${i}]: Fraktion '${b && b.fraktion}' unbekannt` }); continue; }
    if (b.staerke && !(f.staerke || {})[b.staerke]) fehler.push({ code: 'FRAKTION', msg: `besetzung[${i}]: Stärke '${b.staerke}' fehlt bei '${f.id}'` });
    const rezepte = Object.keys(f.rezepte || {}).filter((rz) => !c.kartenart || !f.einsatz || !f.einsatz[rz] || f.einsatz[rz].includes(c.kartenart));
    if (!rezepte.length) fehler.push({ code: 'FRAKTION', msg: `besetzung[${i}]: '${f.id}' hat kein Rezept für Kartenart '${c.kartenart}'` });
    const imRezept = new Set(rezepte.flatMap((rz) => f.rezepte[rz].map((t) => t.rolle)));
    if (b.neue_rolle != null) {
      if (rollen.size && !rollen.has(b.neue_rolle)) fehler.push({ code: 'GEGNER-TYP', msg: `besetzung[${i}]: Rolle '${b.neue_rolle}' unbekannt` });
      imRezept.add(b.neue_rolle);
      if (!gesehen.has(b.neue_rolle)) neu.add(b.neue_rolle);
    }
    for (const rz of rezepte) {
      const rs = f.rezepte[rz].map((t) => t.rolle);
      if (rs.length && rs.every((r) => !gesehen.has(r) && r !== 'grundtyp')) warnungen.push({ code: 'BESETZUNG-NEU', msg: `besetzung[${i}]: Rezept '${rz}' besteht nur aus ungesehenen Rollen (${[...new Set(rs)].join(', ')}) – die Laufzeit setzt grundtyp ein` });
    }
    if ((c.spieler || 3) === 1 && imRezept.has('haescher')) warnungen.push({ code: 'BESETZUNG-SOLO', msg: `besetzung[${i}]: Häscher bei Solo (die Engine lässt ihn weg)` });
    const enterer = rezepte.reduce((mx, rz) => Math.max(mx, f.rezepte[rz].filter((t) => t.rolle === 'enterer').reduce((s, t) => s + t.n, 0)), 0);
    if (enterer > (c.spieler || 3)) warnungen.push({ code: 'BESETZUNG-ENTERER', msg: `besetzung[${i}]: ${enterer} Enterer bei ${c.spieler || 3} Spielern (höchstens 1 je Spieler)` });
  }
  if (neu.size > 1) fehler.push({ code: 'BESETZUNG-NEU', msg: `mehr als eine neue_rolle je Gefecht (${[...neu].join(', ')}) – höchstens eine ungesehene Rolle` });
  return { fehler, warnungen };
}

module.exports = { pruefeBesetzung, load, instantiate, expand, resolveParams, fuerSpielleiter, testRegiebuch, KAT };
