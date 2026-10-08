'use strict';
// Spielleiter-Tests ohne LLM (CONTRACT-S1 §8.3) – npm run test:spielleiter. Kein Netz, keine LLM-Aufrufe, < 10 s.
//
//   0. Schnittstelle: server/mission/llm.js – off wirft, live ohne LLM_LIVE=1 wirft, replay ohne Aufzeichnung wirft
//      mit Hinweis auf --record (kein Live-Fallback), Schlüssel stabil gegen Schlüsselreihenfolge
//   1. Prüfer: m1–m3 gültig; kaputte Bücher aus tools/fixtures/regiebuecher-kaputt/ liefern ihren Code mit Begründung
//   2. Kontext: tools/fixtures/context/*.weltstand.json -> Context.build == *.context.json (Golden), deterministisch
//   3. Replay: Aufzeichnungen tools/fixtures/llm/<kind>/*.json (aus dem Trockenversuch) -> Grobplan-Prüfung bzw.
//      katalog.instantiate + Prüfer -> erwartetes Ergebnis (Feld 'erwartet' in der Aufzeichnung)
//   4. Mock: Weltstand -> Kontext -> mock-Grobplan -> Grobplan-Prüfung -> mock-Szenen -> Regiebuch-Prüfer, ohne Fehler
//   5. Registry: jedes do/check in content/regiebuecher/* steht in Registry.describe()
//
// Fehlt ein Baustein eines anderen Teams (Prüfer-Fixtures, Registry, Bücher), wird der Teil als „übersprungen“ gemeldet,
// nicht als grün. Aufruf: node tools/test-spielleiter.js [--update] [--strict] [--verbose]
//   --update  schreibt Kontext-Goldens und 'erwartet' in den Aufzeichnungen neu (nur bewusst, Diff ansehen!)
//   --strict  übersprungene Teile zählen als Fehler (für die Integration, wenn alle Teile da sein müssen)
//
// Die Helfer checkGrobplan / assembleScene / sceneTestBook sind aus dem Trockenversuch übernommen
// (concept/regiebuch/trockenversuch/grobplan.js → pruefe, szene.js → baueSzene/pruefRegiebuch) und exportiert.
// In S2 gehören sie in den Szenen-Bauer des Servers (z. B. server/mission/spielleiter.js).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const LLM = require('../server/mission/llm.js');
const Context = require('../server/mission/context.js');
const Locations = require('../shared/locations.js');

// ---------- Module der anderen Teams (defensiv) ----------
function tryRequire(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return { mod: null, why: `${rel} fehlt` };
  try { return { mod: require(file) }; } catch (e) { return { mod: null, why: `${rel} lädt nicht: ${e.message.split('\n')[0]}` }; }
}
function resolveChecker() {
  const c = tryRequire('server/mission/checker.js');
  if (c.mod && typeof c.mod.check === 'function') return { check: c.mod.check, src: 'server/mission/checker.js' };
  const old = require('./check-missions.js');
  return { check: old.check, src: 'tools/check-missions.js' + (c.why ? ` (${c.why})` : '') };
}
const CHECKER = resolveChecker();
const Katalog = require('./katalog.js');

// Prüfer-Ergebnis vereinheitlichen: { errors, warnings }
function checkBook(book) {
  const r = CHECKER.check(book) || {};
  return { errors: r.errors || [], warnings: r.warnings || [] };
}

// ---------- Umgebung für die Grobplan-Prüfung ----------
function buildEnv(katalog) {
  const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  const npc = new Set(Object.keys(REG.npc).filter((k) => !k.startsWith('$')));
  const npcFile = path.join(ROOT, 'content', 'npc.json');
  if (fs.existsSync(npcFile)) { try { for (const k of Object.keys(JSON.parse(fs.readFileSync(npcFile, 'utf8')).npc || {})) npc.add(k); } catch (e) { /* bleibt bei bausteine.json */ } }
  return {
    katalog,
    LOC: Object.fromEntries(Locations.LOCATIONS.map((l) => [l.id, l])),
    MAP_OF_LOC: Object.fromEntries(Locations.LOCATIONS.filter((l) => l.scene.beam).map((l) => [l.scene.beam.map, l.id])),
    karten: REG.karten,
    npc: [...npc],
  };
}
function hops(LOC, a, b) {
  if (a === b) return 0;
  const seen = new Set([a]); let front = [a]; let d = 0;
  while (front.length) { d++; const next = []; for (const x of front) for (const y of (LOC[x] ? LOC[x].links : [])) { if (y === b) return d; if (!seen.has(y)) { seen.add(y); next.push(y); } } front = next; }
  return -1;
}

// ---------- Grobplan-Prüfung (aus trockenversuch/grobplan.js → pruefe) ----------
function checkGrobplan(g, env) {
  const KAT = env.katalog; const LOC = env.LOC; const NPC = env.npc;
  const E = [];
  for (const k of ['format', 'id', 'titel', 'auftraggeber', 'zielspieldauer_min', 'aufhaenger', 'erinnerung', 'szenen', 'entscheidungen', 'ausgaenge']) if (!(k in g)) E.push(`Feld '${k}' fehlt`);
  if (!Array.isArray(g.szenen)) return E;
  if (!NPC.includes(g.auftraggeber)) E.push(`Auftraggeber '${g.auftraggeber}' unbekannt`);
  if (g.szenen.length < 3 || g.szenen.length > 6) E.push(`${g.szenen.length} Szenen (erlaubt 3–6)`);
  const ids = new Set(g.szenen.map((s) => s.id)); const aus = new Set(Object.keys(g.ausgaenge || {}));
  const s0 = g.szenen[0];
  if (s0 && (s0.szenentyp !== 'hafen' || s0.ort !== 'hafen')) E.push('Erste Szene ist nicht Szenentyp hafen am Ort hafen');
  let summe = 0; const seen = new Set([s0 && s0.id]); const vorher = new Set();
  for (const s of g.szenen) {
    const p = `Szene '${s.id}'`;
    const st = KAT.szenentypen[s.szenentyp];
    if (!st) E.push(`${p}: Szenentyp '${s.szenentyp}' nicht registriert`);
    else if (st.status !== 'verfuegbar') E.push(`${p}: Szenentyp '${s.szenentyp}' ist noch nicht spielbar`);
    if (!LOC[s.ort]) E.push(`${p}: Ort '${s.ort}' gibt es nicht`);
    if (s.karte && !env.karten[s.karte]) E.push(`${p}: Außenkarte '${s.karte}' gibt es nicht`);
    if (s.karte && env.MAP_OF_LOC[s.karte] !== s.ort) E.push(`${p}: Außenkarte '${s.karte}' gehört zu Ort '${env.MAP_OF_LOC[s.karte]}', nicht zu '${s.ort}'`);
    const mols = s.molekuele || [];
    if (st && (mols.length < st.molekuele_plaetze.min || mols.length > st.molekuele_plaetze.max)) E.push(`${p}: ${mols.length} Moleküle, Szenentyp erlaubt ${st.molekuele_plaetze.min}–${st.molekuele_plaetze.max}`);
    for (const m of mols) {
      const mol = KAT.molekuele[m.id];
      if (!mol) { E.push(`${p}: Molekül '${m.id}' nicht registriert`); continue; }
      const u = mol.umsetzungen.find((x) => x.id === m.umsetzung);
      if (!u) { E.push(`${p}: Molekül '${m.id}' hat keine Umsetzung '${m.umsetzung}'`); continue; }
      if (u.status !== 'verfuegbar') E.push(`${p}: Umsetzung '${m.id}/${m.umsetzung}' ist noch nicht spielbar`);
      if (st && !mol.szenentypen.includes(st.kennung) && st.id !== 'hafen') E.push(`${p}: Molekül '${m.id}' passt nicht zu Szenentyp ${st.kennung} ${st.name}`);
      if (st && u.schauplatz !== st.bereich && st.id !== 'hafen') E.push(`${p}: Umsetzung '${m.umsetzung}' spielt '${u.schauplatz}', Szenentyp ist '${st.bereich}'`);
      if (u.params.loc && u.params.loc.werte && !u.params.loc.werte.includes(s.ort)) E.push(`${p}: Umsetzung '${m.umsetzung}' gibt es nur an ${u.params.loc.werte.join(', ')}`);
      if (u.params.map && u.params.map.werte && !u.params.map.werte.includes(s.karte)) E.push(`${p}: Umsetzung '${m.umsetzung}' braucht Karte ${u.params.map.werte.join(', ')}`);
      for (const n of u.nach || []) if (!vorher.has(n)) E.push(`${p}: Umsetzung '${m.umsetzung}' setzt '${n}' in einer früheren Szene voraus`);
      vorher.add(`${m.id}/${m.umsetzung}`);
    }
    summe += Number(s.dauer_min) || 0;
    for (const w of s.weiter || []) {
      const n = String(w.nach || '');
      if (n.startsWith('ausgang:')) { if (!aus.has(n.slice(8))) E.push(`${p}: Ausgang '${n.slice(8)}' fehlt`); } else if (!ids.has(n)) E.push(`${p}: Folgeszene '${n}' gibt es nicht`); else seen.add(n);
    }
    if (!(s.weiter || []).length) E.push(`${p}: kein 'weiter'`);
  }
  for (const s of g.szenen) if (!seen.has(s.id)) E.push(`Szene '${s.id}' ist nicht erreichbar`);
  const byId = Object.fromEntries(g.szenen.map((s) => [s.id, s]));
  let sprungMin = 0;
  for (const s of g.szenen) for (const [i, w] of (s.weiter || []).entries()) {
    const t = byId[w.nach]; if (!t || !LOC[s.ort] || !LOC[t.ort]) continue;
    const h = hops(LOC, s.ort, t.ort);
    if (h < 0) E.push(`Route '${s.id}' (${s.ort}) → '${t.id}' (${t.ort}): keine Verbindung`);
    else if (i === 0) sprungMin += h * 0.5;
  }
  const z = Number(g.zielspieldauer_min) || 0; const gesamt = summe + sprungMin;
  if (z && (gesamt < z * 0.75 || gesamt > z * 1.25)) E.push(`Dauer ${gesamt} min (Szenen ${summe} + Sprünge ${sprungMin}) passt nicht zu Ziel ${z} min (±25 %)`);
  const reachedOut = new Set(g.szenen.flatMap((s) => (s.weiter || []).map((w) => String(w.nach || '')).filter((n) => n.startsWith('ausgang:')).map((n) => n.slice(8))));
  for (const k of Object.keys(g.ausgaenge || {})) if (!reachedOut.has(k)) E.push(`Ausgang '${k}' wird von keiner Szene erreicht`);
  for (const m of JSON.stringify(g).matchAll(/npc_(?:haltung|gedaechtnis):? ([a-z_]+)/g)) if (!NPC.includes(m[1])) E.push(`Folge für unbekannten NSC '${m[1]}' (neue NSC nur als neu:<name>, Folgen als welt_fakt)`);
  for (const e of g.entscheidungen || []) {
    if (!ids.has(e.szene)) E.push(`Entscheidung in unbekannter Szene '${e.szene}'`);
    if (!Array.isArray(e.optionen) || e.optionen.length < 2) E.push(`Entscheidung '${e.frage}' hat weniger als 2 Optionen`);
    const folgen = new Set((e.optionen || []).map((o) => (o.folge || '').trim()));
    if (folgen.size < (e.optionen || []).length) E.push(`Entscheidung '${e.frage}': Optionen mit gleicher Folge (Scheinwahl)`);
  }
  const na = Object.keys(g.ausgaenge || {}).length;
  if (na < 2 || na > 3) E.push(`${na} Ausgänge (erlaubt 2–3)`);
  for (const [k, a] of Object.entries(g.ausgaenge || {})) if (!(a.folgen || []).length) E.push(`Ausgang '${k}' ohne Folgen`);
  return [...new Set(E)];
}

// ---------- Szene zusammensetzen (aus trockenversuch/szene.js → baueSzene/pruefRegiebuch) ----------
const target = (n) => (n.startsWith('ausgang:') ? { complete: n.slice(8) } : { goto: n });
function assembleScene(g, s, answer, env) {
  const KAT = env.katalog;
  const a = JSON.parse(JSON.stringify(answer));   // nie die Antwort selbst verändern (Fehler im Trockenversuch)
  const E = []; const steps = []; const texte = {}; const buehne = { orte: [] }; const besetzung = { npc: [] };
  const mols = a.molekuele || [];
  if (mols.length !== s.molekuele.length) E.push(`${mols.length} Moleküle statt ${s.molekuele.length} wie im Grobplan`);
  mols.forEach((m, i) => {
    const soll = s.molekuele[i] || {};
    if (m.id !== soll.id || m.umsetzung !== soll.umsetzung) E.push(`Molekül ${i + 1}: ${m.id}/${m.umsetzung} statt ${soll.id}/${soll.umsetzung}`);
    const mol = KAT.molekuele[m.id]; const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung);
    if (!u) return;
    const id = mols.length > 1 ? `${s.id}_${i + 1}` : s.id;
    const weiter = i < mols.length - 1 ? `${s.id}_${i + 2}` : '__weiter__';
    const { frag, errs } = Katalog.instantiate(u, m.params || {}, id, weiter);
    E.push(...errs.map((e) => `${m.id}/${m.umsetzung}: ${e}`));
    steps.push(...frag.steps); Object.assign(texte, frag.texte);
    for (const [k, v] of Object.entries(frag.buehne || {})) buehne[k] = Array.isArray(v) ? [...new Set([...(buehne[k] || []), ...v])] : Object.assign(buehne[k] || {}, v);
    for (const [k, v] of Object.entries(frag.besetzung || {})) besetzung[k] = Array.isArray(v) ? [...new Set([...(besetzung[k] || []), ...v])] : Object.assign(besetzung[k] || {}, v);
  });
  const w = a.wendung;
  if (s.wendung && !w) E.push(`Der Grobplan sieht eine Wendung vor („${s.wendung}“), die Antwort hat keine`);
  if (w && steps[0]) {
    if (!w.kennung || !w.ankuendigung || !Array.isArray(w.wirkung) || !w.wirkung.length) E.push("Wendung braucht 'kennung', 'ankuendigung' und eine nicht leere 'wirkung'");
    const at = Number(w.nach_s);
    if (!(at >= 20 && at <= 120)) E.push(`Wendung: nach_s = ${w.nach_s}, erlaubt 20–120`);
    const erlaubt = ['setFlag', 'reward', 'radio', 'oda', 'log'];
    for (const x of w.wirkung || []) if (!(x.do === 'pay_marks' || (Object.keys(x).length === 1 && erlaubt.includes(Object.keys(x)[0])))) E.push(`Wendung: Aktion ${JSON.stringify(x)} ist nicht erlaubt`);
    (steps[0].timers = steps[0].timers || []).push({ at: at || 30, do: [{ wendung: `${s.id.split('_')[0]}_${w.kennung}`.slice(0, 40), ankuendigung: { oda: w.ankuendigung, art: 'gleichzeitig' }, wirkung: w.wirkung || [] }] });
  }
  let nr = 0;
  const extract = (node) => {
    if (Array.isArray(node)) return node.forEach(extract);
    if (!node || typeof node !== 'object') return;
    for (const k of ['oda', 'log']) if (typeof node[k] === 'string' && !node[k].startsWith('@')) { const key = `${s.id}.t${++nr}`; texte[key] = node[k]; node[k] = '@' + key; }
    if (node.radio && typeof node.radio.text === 'string' && !node.radio.text.startsWith('@')) { const key = `${s.id}.t${++nr}`; texte[key] = node.radio.text; node.radio.text = '@' + key; }
    for (const v of Object.values(node)) extract(v);
  };
  extract(steps);
  for (const x of JSON.stringify(steps).match(/"radio":{"from":"([^"]+)"/g) || []) { const n = x.slice(17, -1); if (!besetzung.npc.includes(n)) besetzung.npc.push(n); }
  for (const x of JSON.stringify(steps).match(/"setFlag":\{[^}]*\}/g) || []) for (const [k, v] of Object.entries(JSON.parse(x.slice(10)))) if (typeof v === 'string' || k === 'name') E.push(`setFlag {"${k}": ${JSON.stringify(v)}}: der Schlüssel ist der Flag-Name, der Wert true – richtig wäre {"${typeof v === 'string' ? v : k}": true}`);
  const soll = s.weiter.map((x) => x.nach);
  let zweige = (a.verzweigung || []).filter((z) => z && z.nach);
  if (soll.length === 1) zweige = [{ nach: soll[0] }];
  else {
    if (zweige.length < 2) E.push(`Szene verzweigt im Grobplan nach ${soll.join(', ')}, aber 'verzweigung' hat ${zweige.length} Einträge`);
    for (const z of zweige) if (!soll.includes(z.nach)) E.push(`Verzweigung nach '${z.nach}', im Grobplan nicht vorgesehen`);
    for (const n of soll) if (!zweige.some((z) => z.nach === n)) E.push(`Verzweigung: Ziel '${n}' aus dem Grobplan wird nie erreicht`);
    const gesetzt = new Set(JSON.stringify(mols).match(/"setFlag":\{[^}]*\}/g) || []);
    const gesetzteFlags = new Set([...gesetzt].flatMap((x) => Object.keys(JSON.parse(x.slice(10)))));
    for (const z of zweige) for (const f of (JSON.stringify(z.if || {}).match(/"flag":"([^"]+)"/g) || []).map((x) => x.slice(8, -1))) if (!gesetzteFlags.has(f)) E.push(`Verzweigung prüft Flag '${f}', das keine Folge setzt`);
  }
  for (const st of steps) {
    if (!st.next) continue;
    st.next = st.next.flatMap((n) => {
      if (n.goto !== '__weiter__') return [n];
      const { goto, ...rest } = n;
      return zweige.map((z, i) => Object.assign({}, rest, { if: i < zweige.length - 1 && z.if ? { all: [n.if, z.if] } : n.if }, target(z.nach)));
    });
  }
  return { steps, texte, buehne, besetzung, fehler: E };
}
function sceneTestBook(g, s, sz) {
  const vorher = { id: 'start', objectives: [], next: [{ if: true, goto: sz.steps[0] ? sz.steps[0].id : s.id }], skip: [] };
  const ziele = [...new Set(s.weiter.map((w) => w.nach))];
  const platzhalter = ziele.filter((n) => !n.startsWith('ausgang:')).map((n) => ({ id: n, objectives: [], next: [{ if: true, complete: 'platzhalter' }], skip: [] }));
  const ausgaenge = { platzhalter: { beschreibung: 'Rest der Mission (noch nicht ausgearbeitet)', folgen: [{ chronik: '@test.text' }] } };
  for (const n of ziele.filter((x) => x.startsWith('ausgang:'))) ausgaenge[n.slice(8)] = { beschreibung: (g.ausgaenge[n.slice(8)] || {}).wann || n, folgen: [{ chronik: '@test.text' }] };
  return {
    format: 'regiebuch/1', id: `${g.id}_${s.id}`.slice(0, 40),
    kopf: { titel: g.titel.slice(0, 60), art: 'mission', auftraggeber: g.auftraggeber, zielspieldauer_min: g.zielspieldauer_min },
    buch: { von: [{ npc: g.auftraggeber }], briefing: '@test.text', belohnung: '@test.text' },
    buehne: Object.assign({}, sz.buehne, { orte: [...new Set(['hafen', ...(sz.buehne.orte || [])])] }),
    besetzung: Object.assign({}, sz.besetzung, { npc: [...new Set([g.auftraggeber, ...(sz.besetzung.npc || [])])] }),
    steps: [vorher, ...sz.steps, ...platzhalter], on: {}, ausgaenge,
    texte: Object.assign({ 'test.text': 'Platzhalter' }, sz.texte),
  };
}
function parseJsonAnswer(text) {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  return JSON.parse(text.slice(a, b + 1));
}
// Szene aus Antworttext -> { gueltig, fehler: Codes (sortiert, eindeutig), details }
function evaluateScene(g, sid, text, env) {
  const s = (g.szenen || []).find((x) => x.id === sid);
  if (!s) return { gueltig: false, fehler: ['SZENE-UNBEKANNT'], details: [`Szene '${sid}' fehlt im Grobplan`] };
  let a;
  try { a = parseJsonAnswer(text); } catch (e) { return { gueltig: false, fehler: ['JSON'], details: [e.message] }; }
  const sz = assembleScene(g, s, a, env);
  const r = checkBook(sceneTestBook(g, s, sz));
  const codes = [...new Set([...sz.fehler.map(() => 'SZENE'), ...r.errors.map((e) => e.code)])].sort();
  return { gueltig: !codes.length, fehler: codes, details: [...sz.fehler, ...r.errors.map((e) => `${e.code} ${e.p}: ${e.msg}`)] };
}
function evaluateGrobplan(text, env) {
  let g;
  try { g = parseJsonAnswer(text); } catch (e) { return { gueltig: false, fehler: ['kein gültiges JSON: ' + e.message] }; }
  const f = checkGrobplan(g, env);
  return { gueltig: !f.length, fehler: f };
}

// Anlässe der Kontext-Fixtures (gehören zum Golden; Änderung = bewusst --update)
const ANLASS = {
  'frisch': { art: 'kampagnenstart', tutorial: true, crew: 1 },
  'nach-m1': { art: 'missionsgrenze', nach: 'm1', crew: 3 },
  'mitten-m2': { art: 'angedockt', mission: 'm2', schritt: 'vaelen', crew: 2 },
  'ohne-tutorial': { art: 'kampagnenstart', tutorial: false, crew: 1 },
  'nach-tutorial': { art: 'missionsgrenze', nach: 'm3', crew: 3, zielspieldauer_min: 12, auftraggeber: 'tesk' },
};

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const UPDATE = args.includes('--update'); const STRICT = args.includes('--strict'); const VERBOSE = args.includes('--verbose');
  const t0 = Date.now();
  const results = [];
  const add = (teil, name, status, detail) => { results.push({ teil, name, status, detail }); };
  const ok = (teil, name, detail) => add(teil, name, 'ok', detail);
  const bad = (teil, name, detail) => add(teil, name, 'fehler', detail);
  const skip = (teil, name, detail) => add(teil, name, 'übersprungen', detail);
  const safe = async (teil, name, fn) => { try { await fn(); } catch (e) { bad(teil, name, 'Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } };

  const katalog = Katalog.load({});
  const env = buildEnv(katalog);
  if (katalog.fehler.length) bad('0', 'Katalog lädt fehlerfrei', katalog.fehler.map((f) => `${f.datei}: ${f.msg}`).join(' | '));

  // ---------- 0. Schnittstelle ----------
  const T0 = '0 Schnittstelle';
  await safe(T0, 'off wirft verständlich', async () => {
    try { await LLM.create({ mode: 'off' }).ask('grobplan', {}); bad(T0, 'off wirft verständlich', 'kein Fehler'); } catch (e) { (/SPIELLEITER_LLM/.test(e.message) ? ok : bad)(T0, 'off wirft verständlich', e.message); }
  });
  await safe(T0, 'Standardmodus ohne SPIELLEITER_LLM = off', async () => {
    const saved = process.env.SPIELLEITER_LLM; delete process.env.SPIELLEITER_LLM;
    try { const m = LLM.create({}).mode; (m === 'off' ? ok : bad)(T0, 'Standardmodus ohne SPIELLEITER_LLM = off', m); } finally { if (saved !== undefined) process.env.SPIELLEITER_LLM = saved; }
  });
  await safe(T0, 'live ohne LLM_LIVE=1 verweigert', async () => {
    const saved = process.env.LLM_LIVE; delete process.env.LLM_LIVE;
    try { await LLM.create({ mode: 'live' }).ask('grobplan', { x: 1 }); bad(T0, 'live ohne LLM_LIVE=1 verweigert', 'kein Fehler'); } catch (e) { (/LLM_LIVE=1/.test(e.message) ? ok : bad)(T0, 'live ohne LLM_LIVE=1 verweigert', e.message); } finally { if (saved !== undefined) process.env.LLM_LIVE = saved; }
  });
  await safe(T0, 'replay ohne Aufzeichnung: Hinweis auf --record', async () => {
    try { await LLM.create({ mode: 'replay' }).ask('szene', { gibt: 'es nicht' }); bad(T0, 'replay ohne Aufzeichnung: Hinweis auf --record', 'kein Fehler'); } catch (e) { (/npm run test:llm -- --record/.test(e.message) ? ok : bad)(T0, 'replay ohne Aufzeichnung: Hinweis auf --record', e.message); }
  });
  await safe(T0, 'Schlüssel unabhängig von der Schlüsselreihenfolge', async () => {
    const k1 = LLM.key('grobplan', { b: 1, a: { y: [1, { d: 2, c: 3 }], x: 'ü' } });
    const k2 = LLM.key('grobplan', { a: { x: 'ü', y: [1, { c: 3, d: 2 }] }, b: 1 });
    const k3 = LLM.key('szene', { b: 1, a: { y: [1, { d: 2, c: 3 }], x: 'ü' } });
    (k1 === k2 && k1 !== k3 && /^[0-9a-f]{40}$/.test(k1) ? ok : bad)(T0, 'Schlüssel unabhängig von der Schlüsselreihenfolge', k1);
  });

  // ---------- 1. Prüfer ----------
  const T1 = '1 Prüfer';
  for (const id of ['m1', 'm2', 'm3']) {
    const file = path.join(ROOT, 'content', 'regiebuecher', `${id}.regiebuch.json`);
    if (!fs.existsSync(file)) { skip(T1, `${id} gültig`, `content/regiebuecher/${id}.regiebuch.json fehlt noch (DATEN)`); continue; }
    await safe(T1, `${id} gültig`, () => {
      const r = checkBook(JSON.parse(fs.readFileSync(file, 'utf8')));
      (r.errors.length ? bad : ok)(T1, `${id} gültig`, r.errors.length ? r.errors.map((e) => `${e.code} ${e.p}: ${e.msg}`).join(' | ') : `0 Fehler, ${r.warnings.length} Warnungen`);
    });
  }
  const KAPUTT = path.join(FIX, 'regiebuecher-kaputt');
  const erwFile = path.join(KAPUTT, 'erwartet.json');
  if (!fs.existsSync(erwFile)) skip(T1, 'kaputte Regiebücher', 'tools/fixtures/regiebuecher-kaputt/erwartet.json fehlt noch (DATEN)');
  else await safe(T1, 'kaputte Regiebücher', () => {
    const erw = JSON.parse(fs.readFileSync(erwFile, 'utf8'));
    const cases = normalizeExpected(erw);
    if (!cases.length) { bad(T1, 'kaputte Regiebücher', 'erwartet.json hat ein unbekanntes Format'); return; }
    const files = fs.readdirSync(KAPUTT).filter((f) => f.endsWith('.json') && f !== 'erwartet.json');
    for (const c of cases) {
      const f = files.find((x) => x === c.datei || x === c.datei + '.json' || x.replace(/\.json$/, '') === c.datei.replace(/\.json$/, ''));
      const name = `kaputt: ${c.datei} → ${c.codes.join('+')}`;
      if (!f) { bad(T1, name, 'Datei fehlt'); continue; }
      let doc; try { doc = JSON.parse(fs.readFileSync(path.join(KAPUTT, f), 'utf8')); } catch (e) { bad(T1, name, 'kein gültiges JSON: ' + e.message); continue; }
      const r = checkBook(doc);
      const got = new Set(r.errors.map((e) => e.code));
      const missing = c.codes.filter((x) => !got.has(x));
      const noReason = r.errors.filter((e) => c.codes.includes(e.code) && !(e.msg && String(e.msg).trim()));
      const extra = [...got].filter((x) => !c.codes.includes(x));
      const hit = r.errors.find((e) => c.codes.includes(e.code));
      if (missing.length || noReason.length) bad(T1, name, `fehlt: ${missing.join(', ') || '–'}${noReason.length ? '; ohne Begründung: ' + noReason.map((e) => e.code).join(', ') : ''}; bekommen: ${[...got].join(', ') || 'keine Fehler'}`);
      else ok(T1, name, `${hit.msg}${extra.length ? ` (zusätzlich: ${extra.join(', ')})` : ''}`);
    }
    for (const f of files) if (!cases.some((c) => f === c.datei || f.replace(/\.json$/, '') === c.datei.replace(/\.json$/, ''))) bad(T1, `kaputt: ${f}`, 'in erwartet.json nicht aufgeführt');
  });

  // ---------- 2. Kontext ----------
  const T2 = '2 Kontext';
  const CTX = path.join(FIX, 'context');
  const worlds = fs.existsSync(CTX) ? fs.readdirSync(CTX).filter((f) => f.endsWith('.weltstand.json')).sort() : [];
  if (!worlds.length) bad(T2, 'Fixtures vorhanden', 'tools/fixtures/context/*.weltstand.json fehlen');
  const contexts = {};
  for (const wf of worlds) {
    const name = wf.replace('.weltstand.json', '');
    await safe(T2, name, () => {
      const w = JSON.parse(fs.readFileSync(path.join(CTX, wf), 'utf8'));
      const anlass = ANLASS[name] || { art: 'test' };
      const c1 = Context.build(w, anlass, katalog);
      const c2 = Context.build(reverseKeys(w), reverseKeys(anlass), katalog);
      contexts[name] = c1;
      const s1 = JSON.stringify(c1);
      if (s1 !== JSON.stringify(c2)) { bad(T2, `${name}: deterministisch`, 'Ergebnis hängt von der Schlüsselreihenfolge ab'); return; }
      const inv = [];
      for (const n of c1.npc) if (n.gedaechtnis.length > Context.NPC_MEMORY) inv.push(`${n.id}: ${n.gedaechtnis.length} Gedächtniseinträge`);
      if (c1.chronik.length > Context.CHRONIK) inv.push(`chronik: ${c1.chronik.length}`);
      if (!isSorted(c1)) inv.push('Schlüssel nicht sortiert');
      if (inv.length) { bad(T2, `${name}: Grenzen`, inv.join(', ')); return; }
      const gf = path.join(CTX, `${name}.context.json`);
      if (UPDATE) { fs.writeFileSync(gf, JSON.stringify(c1, null, 2) + '\n', 'utf8'); ok(T2, `${name} == Golden`, `neu geschrieben (${s1.length} Zeichen)`); return; }
      if (!fs.existsSync(gf)) { bad(T2, `${name} == Golden`, `${name}.context.json fehlt – mit --update anlegen`); return; }
      const golden = JSON.parse(fs.readFileSync(gf, 'utf8'));
      if (JSON.stringify(golden) === s1) ok(T2, `${name} == Golden`, `${s1.length} Zeichen, ${c1.npc.length} NSC, Chronik ${c1.chronik.length}`);
      else bad(T2, `${name} == Golden`, `Abweichung in: ${Object.keys(Object.assign({}, golden, c1)).filter((k) => JSON.stringify(golden[k]) !== JSON.stringify(c1[k])).join(', ')} (bewusst? dann --update)`);
    });
  }

  // ---------- 3. Replay ----------
  const T3 = '3 Replay';
  const LLMFIX = path.join(FIX, 'llm');
  const replay = LLM.create({ mode: 'replay', fixturesDir: LLMFIX });
  let recCount = 0;
  for (const kind of LLM.KINDS) {
    const dir = path.join(LLMFIX, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      recCount++;
      const file = path.join(dir, f);
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      const name = `${kind}: ${rec.name || f}`;
      await safe(T3, name, async () => {
        const k = LLM.key(kind, rec.input);
        if (k !== rec.key || f !== k + '.json') { bad(T3, name, `Schlüssel passt nicht zum input (Datei ${f}, gespeichert ${rec.key}, berechnet ${k})`); return; }
        const ans = await replay.ask(kind, rec.input);
        if (ans.source !== 'replay' || ans.key !== k) { bad(T3, name, 'Antwort nicht aus der Aufzeichnung'); return; }
        const res = kind === 'grobplan' ? evaluateGrobplan(ans.text, env) : evaluateScene(rec.input.grobplan, rec.input.szene, ans.text, env);
        const actual = { gueltig: res.gueltig, fehler: res.fehler };
        if (UPDATE) { rec.erwartet = actual; fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', 'utf8'); ok(T3, name, `erwartet neu: ${res.gueltig ? 'gültig' : res.fehler.length + ' Fehler'}`); return; }
        if (!rec.erwartet) { bad(T3, name, "Feld 'erwartet' fehlt – mit --update anlegen"); return; }
        const same = JSON.stringify(actual) === JSON.stringify({ gueltig: rec.erwartet.gueltig, fehler: rec.erwartet.fehler });
        const what = res.gueltig ? 'gültig' : `ungültig wie erwartet (${res.fehler.length}: ${res.fehler.slice(0, 2).join(' | ')}${res.fehler.length > 2 ? ' …' : ''})`;
        (same ? ok : bad)(T3, name, same ? what : `erwartet ${JSON.stringify(rec.erwartet.fehler)}, bekommen ${JSON.stringify(res.fehler)}${VERBOSE ? ' – ' + res.details.join(' | ') : ''}`);
      });
    }
  }
  if (!recCount) bad(T3, 'Aufzeichnungen vorhanden', 'tools/fixtures/llm/<kind>/*.json fehlen');

  // ---------- 4. Mock ----------
  const T4 = '4 Mock';
  const mock = LLM.create({ mode: 'mock', katalog });
  for (const [name, ctx] of Object.entries(contexts)) {
    await safe(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, async () => {
      const input = { anlass: ctx.anlass, kontext: ctx };
      const a1 = await mock.ask('grobplan', input); const a2 = await mock.ask('grobplan', input);
      if (a1.text !== a2.text || a1.source !== 'mock') { bad(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, 'mock nicht deterministisch'); return; }
      const g = parseJsonAnswer(a1.text);
      const gf = checkGrobplan(g, env);
      if (gf.length) { bad(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, gf.join(' | ')); return; }
      const scenes = g.szenen.filter((s) => (s.molekuele || []).length);
      const errs = [];
      for (const s of scenes) {
        const sa = await mock.ask('szene', { grobplan: g, szene: s.id, kontext: ctx });
        const r = evaluateScene(g, s.id, sa.text, env);
        if (!r.gueltig) errs.push(`${s.id}: ${r.details.join(' | ')}`);
      }
      (errs.length ? bad : ok)(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, errs.length ? errs.join(' || ') : `Grobplan '${g.titel}' (${g.szenen.length} Szenen, Auftraggeber ${g.auftraggeber}) + ${scenes.length} Szenen gültig`);
    });
  }
  if (!Object.keys(contexts).length) skip(T4, 'Mock-Durchlauf', 'keine Kontexte aus Teil 2');

  // ---------- 5. Registry ----------
  const T5 = '5 Registry';
  const reg = tryRequire('server/mission/registry.js');
  if (!reg.mod || typeof reg.mod.describe !== 'function') skip(T5, 'do/check der Bücher in Registry.describe()', reg.why || 'server/mission/registry.js ohne describe() (ENGINE)');
  else await safe(T5, 'do/check der Bücher in Registry.describe()', () => {
    const desc = reg.mod.describe();
    const asJson = JSON.parse(JSON.stringify(desc));
    if (!Array.isArray(asJson) || !asJson.length) { bad(T5, 'Registry.describe() liefert Einträge', 'leer oder kein Array'); return; }
    const known = new Map(asJson.map((e) => [e.id, e]));
    const BOOKS = path.join(ROOT, 'content', 'regiebuecher');
    const books = fs.existsSync(BOOKS) ? fs.readdirSync(BOOKS).filter((f) => f.endsWith('.json')).sort() : [];
    if (!books.length) { skip(T5, 'do/check der Bücher in Registry.describe()', 'keine Bücher in content/regiebuecher'); return; }
    for (const f of books) {
      const used = collectBausteine(JSON.parse(fs.readFileSync(path.join(BOOKS, f), 'utf8')));
      const missing = [...used.do].filter((x) => !known.has(x)).map((x) => 'do ' + x).concat([...used.check].filter((x) => !known.has(x)).map((x) => 'check ' + x));
      const wrongArt = [...used.do].filter((x) => known.has(x) && known.get(x).art && known.get(x).art !== 'aktion').map((x) => `do ${x} ist ${known.get(x).art}`)
        .concat([...used.check].filter((x) => known.has(x) && known.get(x).art && known.get(x).art !== 'pruefung').map((x) => `check ${x} ist ${known.get(x).art}`));
      const all = missing.concat(wrongArt);
      (all.length ? bad : ok)(T5, `${f}: ${used.do.size} do, ${used.check.size} check registriert`, all.length ? all.join(', ') : `Registry kennt ${known.size} Bausteine`);
    }
  });

  // ---------- Ausgabe ----------
  const ms = Date.now() - t0;
  const parts = [...new Set(results.map((r) => r.teil))].sort();
  for (const p of parts) {
    console.log(`\n${p}`);
    for (const r of results.filter((x) => x.teil === p)) console.log(`  ${r.status === 'ok' ? '✓' : r.status === 'fehler' ? '✗' : '–'} ${r.name}${r.detail && (r.status !== 'ok' || VERBOSE) ? `\n      ${r.detail}` : ''}${r.status === 'übersprungen' ? '  [übersprungen]' : ''}`);
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\nPrüfer: ${CHECKER.src}`);
  console.log(`${n('ok')} ok, ${n('fehler')} Fehler, ${n('übersprungen')} übersprungen – ${ms} ms${UPDATE ? ' (--update: Goldens/erwartet neu geschrieben)' : ''}`);
  if (n('übersprungen')) console.log(`NICHT vollständig grün: ${n('übersprungen')} Teil(e) übersprungen, weil Dateien anderer Teams fehlen${STRICT ? ' (--strict: zählt als Fehler)' : ''}.`);
  if (ms > 10000) console.log(`WARNUNG: Laufzeit ${ms} ms über dem Ziel von 10 s`);
  process.exit(n('fehler') || (STRICT && n('übersprungen')) ? 1 : 0);
}

// erwartet.json (DATEN) flexibel lesen: { datei: code | [codes] | { code|codes|fehler } } oder [{ datei|file, code|codes }]
function normalizeExpected(erw) {
  const codesOf = (v) => {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.flatMap(codesOf);
    if (v && typeof v === 'object') return codesOf(v.codes || v.code || v.fehler || v.erwartet || []);
    return [];
  };
  let list = [];
  if (Array.isArray(erw)) list = erw.map((e) => ({ datei: String(e.datei || e.file || e.id || ''), codes: codesOf(e) }));
  else if (erw && typeof erw === 'object') {
    const src = erw.faelle || erw.cases || erw.dateien || erw;
    if (Array.isArray(src)) return normalizeExpected(src);
    list = Object.entries(src).filter(([k]) => !k.startsWith('_') && !k.startsWith('$')).map(([k, v]) => ({ datei: k, codes: codesOf(v) }));
  }
  return list.filter((c) => c.datei && c.codes.length);
}
// Alle Baustein-Namen eines Buchs: do: "<name>" (String) und check: "<name>" | { name }
function collectBausteine(doc) {
  const used = { do: new Set(), check: new Set() };
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (typeof n.do === 'string') used.do.add(n.do);
    if (n.check !== undefined) { const c = n.check; if (typeof c === 'string') used.check.add(c); else if (c && typeof c.name === 'string') used.check.add(c.name); }
    for (const v of Object.values(n)) walk(v);
  };
  walk(doc);
  return used;
}
function reverseKeys(x) {
  if (Array.isArray(x)) return x.map(reverseKeys);
  if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).reverse()) o[k] = reverseKeys(x[k]); return o; }
  return x;
}
function isSorted(x) {
  if (Array.isArray(x)) return x.every(isSorted);
  if (x && typeof x === 'object') { const k = Object.keys(x); return k.every((v, i) => i === 0 || k[i - 1] <= v) && Object.values(x).every(isSorted); }
  return true;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { checkGrobplan, assembleScene, sceneTestBook, evaluateScene, evaluateGrobplan, parseJsonAnswer, buildEnv, checkBook, collectBausteine, normalizeExpected, CHECKER, ANLASS };
