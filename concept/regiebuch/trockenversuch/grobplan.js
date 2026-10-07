'use strict';
// Trockenversuch Spielleiter, Stufe 1: Grobplan an der Missionsgrenze (schnell, ohne Details).
// Der Spielleiter plant mit registrierten Szenentypen und Molekülen (tools/katalog.js), nicht mit freien Szenenarten.
// Schlanker Kontext (Weltstand kompakt, Katalog kurz), Denken aus (MAX_THINKING_TOKENS=0), eine Nachbesserung bei Fehlern.
// Aufruf: node concept/regiebuch/trockenversuch/grobplan.js [auftrag-id …] [--model sonnet] [--mod <ordner>]
// Ausgabe: out/<id>.grobplan.json, out/<id>.grobplan.md (lesbar), out/grobplan-messung.md

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const CONCEPT = path.join(DIR, '..');
const ROOT = path.join(CONCEPT, '..', '..');
const OUT = path.join(DIR, 'out');
const Locations = require(path.join(ROOT, 'shared', 'locations.js'));
const Katalog = require(path.join(ROOT, 'tools', 'katalog.js'));
const REG = JSON.parse(fs.readFileSync(path.join(CONCEPT, 'bausteine.json'), 'utf8'));
const args = process.argv.slice(2);
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'sonnet';
const MODS = args.filter((a, i) => args[i - 1] === '--mod').map((d) => path.resolve(d));
const CLAUDE_CLI = process.env.CLAUDE_CLI || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');

const KAT = Katalog.load({ mods: MODS });
const LOC = Object.fromEntries(Locations.LOCATIONS.map((l) => [l.id, l]));
const MAP_OF_LOC = Object.fromEntries(Locations.LOCATIONS.filter((l) => l.scene.beam).map((l) => [l.scene.beam.map, l.id]));
const NPC = Object.keys(REG.npc).filter((k) => !k.startsWith('$'));

function katalogKurz() {
  const L = ['## Orte'];
  for (const l of Locations.LOCATIONS) L.push(`- ${l.id}: ${l.name} (${l.kind}) → Sprünge nach ${l.links.join(', ')}${l.scene.beam ? `; Außenkarte ${l.scene.beam.map}` : ''}${l.scene.dock ? '; Andocken' : ''}. Funde: ${l.hidden.map((h) => h.id).join(', ') || '–'}`);
  L.push('', `## NSC: ${NPC.join(', ')}`, '', 'Nicht vorhanden: verbündete Schiffe, neutrale Schiffe im All, Andocken an anderen Schiffen, Verfolgungen über mehrere Orte, neue Funde, Objekte oder Karten.', '');
  L.push(Katalog.fuerSpielleiter(KAT, 'kurz'));
  return L.join('\n');
}
function weltstandKurz() {
  const w = JSON.parse(fs.readFileSync(path.join(DIR, 'weltstand-nach-tutorial.json'), 'utf8'));
  const L = [`Ort: angedockt in ${w.ort.angedockt}. Marken ${w.schiff.marken}.`, `Flags: ${JSON.stringify(w.welt.flags)}`, `Fakten: ${JSON.stringify(w.welt.fakten)}`, 'NSC:'];
  for (const [id, n] of Object.entries(w.npc)) L.push(`- ${id} (${n.titel} ${n.name}, ${n.fraktion}, Haltung ${n.haltung}): ${n.gedaechtnis.map((g) => g.text).join(' | ')}`);
  L.push('Chronik:'); for (const c of w.chronik) L.push(`- ${c.text}`);
  return L.join('\n');
}

function callClaude(text) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [CLAUDE_CLI, '-p', '--model', MODEL, '--tools', '', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--no-session-persistence', '--strict-mcp-config', '--system-prompt-file', path.join(DIR, 'grobplan-spielleiter.md')],
  { input: text, encoding: 'utf8', cwd: OUT, maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60 * 1000, env: Object.assign({}, process.env, { MAX_THINKING_TOKENS: '0' }) });
  if (r.error || r.status !== 0) throw new Error(`claude fehlgeschlagen (${r.status}): ${r.error || ''} ${(r.stderr || '').slice(0, 300)}`);
  let txt = ''; let thinking = 0; let result = null;
  for (const line of r.stdout.split('\n')) {
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.type === 'stream_event') { const d = (o.event || {}).delta || {}; if (d.type === 'thinking_delta') thinking += (d.thinking || '').length; if (d.type === 'text_delta') txt += d.text; }
    if (o.type === 'result') result = o;
  }
  return { text: (result && result.result) || txt, sec: (Date.now() - t0) / 1000, thinking, cost: result && result.total_cost_usd, out: result && result.usage && result.usage.output_tokens };
}

function hops(a, b) {
  if (a === b) return 0;
  const seen = new Set([a]); let front = [a]; let d = 0;
  while (front.length) { d++; const next = []; for (const x of front) for (const y of (LOC[x] ? LOC[x].links : [])) { if (y === b) return d; if (!seen.has(y)) { seen.add(y); next.push(y); } } front = next; }
  return -1;
}

function pruefe(g) {
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
    if (s.karte && !REG.karten[s.karte]) E.push(`${p}: Außenkarte '${s.karte}' gibt es nicht`);
    if (s.karte && MAP_OF_LOC[s.karte] !== s.ort) E.push(`${p}: Außenkarte '${s.karte}' gehört zu Ort '${MAP_OF_LOC[s.karte]}', nicht zu '${s.ort}'`);
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
  // Sprünge zwischen Szenen: Verbindung muss existieren, Zeit wird angerechnet (Hauptpfad: jeweils erstes 'weiter')
  const byId = Object.fromEntries(g.szenen.map((s) => [s.id, s]));
  let sprungMin = 0;
  for (const s of g.szenen) for (const [i, w] of (s.weiter || []).entries()) {
    const t = byId[w.nach]; if (!t || !LOC[s.ort] || !LOC[t.ort]) continue;
    const h = hops(s.ort, t.ort);
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

function lesbar(g, meta) {
  const L = [`# ${g.titel}`, '', `**Auftraggeber:** ${g.auftraggeber} · **Ziel:** ${g.zielspieldauer_min} min · **Szenen:** ${g.szenen.length}`, '',
    `**Aufhänger:** ${g.aufhaenger}`, '', `**Erinnerung aus dem Weltstand:** ${g.erinnerung}`, '', '## Szenen', ''];
  g.szenen.forEach((s, i) => {
    const st = KAT.szenentypen[s.szenentyp];
    const mols = (s.molekuele || []).map((m) => { const mol = KAT.molekuele[m.id]; const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung); return u ? u.name : `${m.id}/${m.umsetzung}`; });
    L.push(`### ${i + 1}. ${st ? st.kennung + ' ' + st.name : s.szenentyp} – ${LOC[s.ort] ? LOC[s.ort].name : s.ort}${s.karte ? ' (Außenmission)' : ''}, ~${s.dauer_min} min`, '');
    if (mols.length) L.push(`*${mols.join(' + ')}*`, '');
    L.push(s.sachverhalt, '');
    if (s.wendung) L.push(`**Wendung:** ${s.wendung}`, '');
    L.push(`**Weiter:** ${(s.weiter || []).map((w) => `${w.wenn} → ${w.nach}`).join(' · ')}`, '');
  });
  L.push('## Entscheidungen', '');
  for (const e of g.entscheidungen || []) { L.push(`**${e.frage}** (Szene ${e.szene})`); for (const o of e.optionen || []) L.push(`- *${o.text}* → ${o.folge}`); L.push(''); }
  L.push('## Ausgänge', '');
  for (const [k, a] of Object.entries(g.ausgaenge || {})) { L.push(`**${k}** – ${a.wann}`); for (const f of a.folgen || []) L.push(`- ${f}`); L.push(''); }
  L.push('---', `*${meta}*`);
  return L.join('\n');
}

function run(a) {
  const base = `<weltstand>\n${weltstandKurz()}\n</weltstand>\n\n<katalog>\n${katalogKurz()}\n</katalog>\n\n<auftrag>\n${a.auftrag}\n</auftrag>\n\nGib jetzt den Grobplan aus. Nur das JSON-Objekt.`;
  const messung = []; let g = null; let errs = []; let raw = '';
  for (let v = 1; v <= 2; v++) {
    const input = v === 1 ? base : `${base}\n\n<deine_antwort>\n${raw}\n</deine_antwort>\n\n<pruefer>\n${errs.map((e) => '- ' + e).join('\n')}\n</pruefer>\nKorrigiere die Fehler. Nur das JSON-Objekt.`;
    const c = callClaude(input); raw = c.text;
    const a0 = raw.indexOf('{'); const b0 = raw.lastIndexOf('}');
    try { g = JSON.parse(raw.slice(a0, b0 + 1)); errs = pruefe(g); } catch (e) { g = null; errs = ['kein gültiges JSON: ' + e.message]; }
    messung.push({ v, sec: c.sec, thinking: c.thinking, out: c.out, cost: c.cost, fehler: errs.length });
    console.log(`${a.id} v${v}: ${c.sec.toFixed(1)} s (Denken ${c.thinking} Zeichen, ${c.out} Tokens), ${errs.length} Fehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
    if (!errs.length) break;
  }
  if (g) {
    fs.writeFileSync(path.join(OUT, `${a.id}.grobplan.json`), JSON.stringify(g, null, 2));
    const m = messung.map((x) => `v${x.v}: ${x.sec.toFixed(0)} s, ${x.out} Tokens`).join(', ');
    fs.writeFileSync(path.join(OUT, `${a.id}.grobplan.md`), lesbar(g, `Erzeugt in ${m} · Modell ${MODEL} · Prüfer: ${errs.length ? errs.join(' | ') : 'gültig'}`));
  }
  return { id: a.id, messung, gueltig: !errs.length, errs };
}

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  if (KAT.fehler.length) { console.log('Katalog fehlerhaft – erst `node tools/katalog.js` reparieren.'); process.exit(1); }
  if (args.includes('--katalog')) { fs.writeFileSync(path.join(OUT, 'katalog-kurz.md'), katalogKurz()); console.log('katalog-kurz.md geschrieben'); process.exit(0); }
  const all = JSON.parse(fs.readFileSync(path.join(DIR, 'auftraege.json'), 'utf8'));
  const ids = args.filter((x, i) => !x.startsWith('--') && x !== MODEL && args[i - 1] !== '--mod');
  const list = ids.length ? all.filter((x) => ids.includes(x.id)) : all;
  const res = list.map((x) => { try { return run(x); } catch (e) { console.log(`${x.id}: ${e.message}`); return { id: x.id, messung: [], gueltig: false, errs: [e.message] }; } });
  const L = ['# Messung Grobplan (Registry)', '', `Modell ${MODEL}, MAX_THINKING_TOKENS=0, ${new Date().toISOString()}`, '', '| Auftrag | Versuch | Dauer | Denken (Zeichen) | Ausgabe-Tokens | Fehler |', '|---|---|---|---|---|---|'];
  for (const r of res) for (const m of r.messung) L.push(`| ${r.id} | v${m.v} | ${m.sec.toFixed(1)} s | ${m.thinking} | ${m.out} | ${m.fehler} |`);
  fs.writeFileSync(path.join(OUT, 'grobplan-messung.md'), L.join('\n'));
  console.log(`\n${res.filter((r) => r.gueltig).length}/${res.length} gültig.`);
}
